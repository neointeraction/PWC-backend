// Derived "stage" + ageing/flag resolution for a student — computed live from existing
// data, NOT persisted. The displayed stage is a composite of `workflowStatus` plus
// form/assessment/session sub-state (e.g. "Pre-Counselling — Student" = student's form in,
// parent's still pending), and the 🚩 flag is a pure function of the clock:
//
//   • Ageing flag  — the student is idle on a stage that awaits a student/parent action
//     for more than AGEING_FLAG_THRESHOLD_DAYS calendar days (IST). "Idle since" is read
//     from whichever existing timestamp marks entry into the current stage.
//   • Missed-session flag — a booked session whose date has passed without completion, or
//     an explicit student no-show. (Session stages are never ageing-flagged; they surface
//     here instead — see docs/api-list.md "Student stage & ageing".)
//
// Nothing here is written to the DB: ageing changes with the clock, so it is always
// derived at read time. See the design discussion — the only stage lacking a dedicated
// timestamp is "Profile Completed, no forms yet", which falls back to `student.updatedAt`
// (accurate unless an admin edits the row while it sits idle).

import type { WorkflowStatus } from "@prisma/client";
import { calendarDaysBetween, istDayNumber } from "../../common/utils/istDate.js";

// "Beyond 2 days idle" → flag once strictly more than 2 calendar days have elapsed (i.e.
// on day 3). Change this single constant to retune, or flip `>` to `>=` in `isFlagged`.
export const AGEING_FLAG_THRESHOLD_DAYS = 2;

// Derived stage keys the UI's "All Stages" dropdown filters on. Finer-grained than
// WorkflowStatus (the "— Student/— Parent" halves), matching the mock.
export const DERIVED_STAGES = [
  "LOGIN_ACTIVATED",
  "PROFILE_COMPLETED",
  "PRE_COUNSELLING_STUDENT",
  "PRE_COUNSELLING_PARENT",
  "ASSESSMENT_PENDING",
  "ASSESSMENT_COMPLETED",
  "SESSION_BOOKED",
  "SESSION_1_COMPLETED",
  "COUNSELLOR_FEEDBACK_REPORT",
  "SESSION_2_COMPLETED",
  "COUNSELLOR_FEEDBACK",
  "FEEDBACK_STUDENT",
  "FEEDBACK_PARENT",
  "FEEDBACK_PENDING",
  "CLOSED",
  "DISCONTINUED",
] as const;

export type DerivedStage = (typeof DERIVED_STAGES)[number];

export const STAGE_LABELS: Record<DerivedStage, string> = {
  LOGIN_ACTIVATED: "Login Activated",
  PROFILE_COMPLETED: "Profile Completed",
  PRE_COUNSELLING_STUDENT: "Pre-Counselling — Student",
  PRE_COUNSELLING_PARENT: "Pre-Counselling — Parent",
  ASSESSMENT_PENDING: "Assessment Pending",
  ASSESSMENT_COMPLETED: "Assessment Completed",
  SESSION_BOOKED: "Session Booked",
  SESSION_1_COMPLETED: "Session 1 Completed",
  COUNSELLOR_FEEDBACK_REPORT: "Counsellor Feedback Report",
  SESSION_2_COMPLETED: "Session 2 Completed",
  COUNSELLOR_FEEDBACK: "Counsellor Feedback",
  FEEDBACK_STUDENT: "Feedback — Student",
  FEEDBACK_PARENT: "Feedback — Parent",
  FEEDBACK_PENDING: "Feedback Pending",
  CLOSED: "Closed",
  DISCONTINUED: "Discontinued",
};

export type FlagReason = "IDLE" | "MISSED_SESSION";

export interface StageInfo {
  stage: DerivedStage;
  stageLabel: string;
  stageEnteredAt: string; // ISO — the clock the age is measured from
  ageDays: number; // calendar days (IST) since stageEnteredAt
  flagged: boolean;
  flagReason: FlagReason | null;
}

// --- The subset of a Student (with relations) this resolver reads. Keep in sync with
// `stageRelationsInclude` below. ---
type SubmittedForm = { submittedAt: Date | null; formTemplate: { formType: string } };
type AttemptRow = { status: string; submittedAt: Date | null };
type SessionRow = { status: string; scheduledDate: Date; studentNoShow: boolean };

export interface StudentForStage {
  workflowStatus: WorkflowStatus;
  createdAt: Date;
  updatedAt: Date;
  isDiscontinued: boolean;
  discontinuedAt: Date | null;
  formSubmissions: SubmittedForm[];
  assessmentAttempts: AttemptRow[];
  sessions: SessionRow[];
}

// Prisma include fragment that loads exactly the child fields the resolver needs (and no
// more). Spread into a findMany/findUnique alongside the display include, then stripped
// from the response by the caller.
export const stageRelationsInclude = {
  formSubmissions: {
    select: { submittedAt: true, formTemplate: { select: { formType: true } } },
  },
  assessmentAttempts: { select: { status: true, submittedAt: true } },
  sessions: { select: { status: true, scheduledDate: true, studentNoShow: true } },
} as const;

function calendarDaysSince(from: Date, now: Date): number {
  return Math.max(0, calendarDaysBetween(from, now));
}

function firstSubmittedAt(forms: SubmittedForm[], formType: string): Date | null {
  const submitted = forms
    .filter((f) => f.formTemplate.formType === formType && f.submittedAt)
    .map((f) => f.submittedAt as Date);
  if (submitted.length === 0) return null;
  return submitted.reduce((a, b) => (a < b ? a : b));
}

function latest(dates: (Date | null)[]): Date | null {
  const present = dates.filter((d): d is Date => d != null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => (a > b ? a : b));
}

type Resolved = { stage: DerivedStage; actionable: boolean; clock: Date };

// Maps workflowStatus + sub-state → the displayed stage, whether it awaits a student/
// parent action (ageing-flaggable), and the timestamp the age is measured from. At
// PROFILE_COMPLETED the workflow only advances once BOTH pre-counselling forms are in, so
// at most one is present here; likewise the feedback split.
function resolveStage(s: StudentForStage): Resolved {
  const preStudent = firstSubmittedAt(s.formSubmissions, "PRE_COUNSELLING_STUDENT");
  const preParent = firstSubmittedAt(s.formSubmissions, "PRE_COUNSELLING_PARENT");
  const fbStudent = firstSubmittedAt(s.formSubmissions, "FEEDBACK_STUDENT");
  const fbParent = firstSubmittedAt(s.formSubmissions, "FEEDBACK_PARENT");

  switch (s.workflowStatus) {
    case "DRAFT":
      // "Login Activated": account exists (and, once mustChangePassword clears, has been
      // logged into) but the profile isn't confirmed. Clock from account creation.
      return { stage: "LOGIN_ACTIVATED", actionable: true, clock: s.createdAt };

    case "PROFILE_COMPLETED":
      if (preStudent && !preParent)
        return { stage: "PRE_COUNSELLING_STUDENT", actionable: true, clock: preStudent };
      if (preParent && !preStudent)
        return { stage: "PRE_COUNSELLING_PARENT", actionable: true, clock: preParent };
      // No forms yet — the one stage with no dedicated timestamp; updatedAt = the
      // confirm-profile write (password change touches User, not Student).
      return { stage: "PROFILE_COMPLETED", actionable: true, clock: s.updatedAt };

    case "PRE_COUNSELLING_FORMS_SUBMITTED":
    case "ASSESSMENT_PENDING":
      // Both forms in, assessment not finished — idle since the later of the two forms.
      return {
        stage: "ASSESSMENT_PENDING",
        actionable: true,
        clock: latest([preStudent, preParent]) ?? s.updatedAt,
      };

    case "ASSESSMENT_COMPLETED": {
      const submittedAttempt = latest(
        s.assessmentAttempts.filter((a) => a.status === "SUBMITTED").map((a) => a.submittedAt)
      );
      return { stage: "ASSESSMENT_COMPLETED", actionable: true, clock: submittedAttempt ?? s.updatedAt };
    }

    // Session phase: never ageing-flagged (waiting on a scheduled date / on staff). The
    // missed-session check below supplies the flag instead.
    case "SESSION_SCHEDULED":
      return { stage: "SESSION_BOOKED", actionable: false, clock: s.updatedAt };
    case "SESSION_1_COMPLETED":
      return { stage: "SESSION_1_COMPLETED", actionable: false, clock: s.updatedAt };
    case "COUNSELLOR_FEEDBACK_REPORT":
      return { stage: "COUNSELLOR_FEEDBACK_REPORT", actionable: false, clock: s.updatedAt };
    case "SESSION_2_COMPLETED":
      return { stage: "SESSION_2_COMPLETED", actionable: false, clock: s.updatedAt };
    case "COUNSELLOR_FEEDBACK":
      return { stage: "COUNSELLOR_FEEDBACK", actionable: false, clock: s.updatedAt };

    case "STUDENT_PARENT_FEEDBACK":
      if (fbStudent && !fbParent)
        return { stage: "FEEDBACK_STUDENT", actionable: true, clock: fbStudent };
      if (fbParent && !fbStudent)
        return { stage: "FEEDBACK_PARENT", actionable: true, clock: fbParent };
      return { stage: "FEEDBACK_PENDING", actionable: true, clock: s.updatedAt };

    case "CLOSED":
      return { stage: "CLOSED", actionable: false, clock: s.updatedAt };
  }
}

// A session counts as "missed" once its date has passed while still merely SCHEDULED, or
// the student was explicitly marked no-show. Completed/rescheduled/cancelled don't count.
function hasMissedSession(s: StudentForStage, now: Date): boolean {
  const today = istDayNumber(now);
  return s.sessions.some(
    (sn) =>
      sn.studentNoShow ||
      (sn.status === "SCHEDULED" && istDayNumber(sn.scheduledDate) < today)
  );
}

export function computeStageInfo(s: StudentForStage, now: Date = new Date()): StageInfo {
  // Discontinued overrides the derived workflow stage entirely — excluded from ageing/
  // missed-session flags (they've left the project, not idle within it).
  if (s.isDiscontinued) {
    const clock = s.discontinuedAt ?? s.updatedAt;
    return {
      stage: "DISCONTINUED",
      stageLabel: STAGE_LABELS.DISCONTINUED,
      stageEnteredAt: clock.toISOString(),
      ageDays: calendarDaysSince(clock, now),
      flagged: false,
      flagReason: null,
    };
  }

  const { stage, actionable, clock } = resolveStage(s);
  const ageDays = calendarDaysSince(clock, now);

  const missedSession = stage !== "CLOSED" && hasMissedSession(s, now);
  const idle = actionable && ageDays > AGEING_FLAG_THRESHOLD_DAYS;

  const flagReason: FlagReason | null = missedSession ? "MISSED_SESSION" : idle ? "IDLE" : null;

  return {
    stage,
    stageLabel: STAGE_LABELS[stage],
    stageEnteredAt: clock.toISOString(),
    ageDays,
    flagged: flagReason != null,
    flagReason,
  };
}
