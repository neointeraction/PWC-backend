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
import { combineDateTime } from "../sessions/sessions.service.js";
import { calendarDaysBetween, istDayNumber } from "../../common/utils/istDate.js";

// "Beyond 2 days idle" → flag once strictly more than 2 calendar days have elapsed (i.e.
// on day 3). Change this single constant to retune, or flip `>` to `>=` in `isFlagged`.
export const AGEING_FLAG_THRESHOLD_DAYS = 2;

// Derived stage keys the UI's "All Stages" dropdown filters on. Finer-grained than
// WorkflowStatus (the "— Student/— Parent" halves), matching the mock. This set stays the
// full, precise 17 values — it's what `?stage=` filtering and the idle-nudge scheduler
// (`src/scheduler/jobs.ts`) key off, and both need every real state distinguished (e.g. the
// scheduler routes a different reminder email to "hasn't started the assessment yet" than
// to "hasn't submitted a pre-counselling form yet" — collapsing them would misroute copy).
// For the *display* label folding the frontend's 12-row stage report wants (no dedicated
// row for Assessment Pending / Counsellor Feedback / Feedback Pending / Closed /
// Discontinued), see `REPORT_STAGE_LABELS` below — that folds only the label shown, not
// this key.
export const DERIVED_STAGES = [
  "INVITED",
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
  INVITED: "Invited",
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
  // "Report Downloaded" rather than "Closed" — CLOSED only ever fires from the student's
  // own fetch of their assessment report (see markReportDeliveredToStudent in
  // reports.service.ts), so that's the concrete, student-facing event this label should
  // name, not an abstract case-management state.
  CLOSED: "Report Downloaded",
  DISCONTINUED: "Discontinued",
};

// Display-only fold for the frontend's PROJECT_STAGES_OPTIONS report/dropdown, which has
// no dedicated row for these stages. Maps each to the label of its nearest neighbor in
// the workflow sequence; `stageInfo.stage` (the filter/scheduler key) is untouched — only
// the label shown to the report changes. Apply via `reportStageLabel()` at the API
// response boundary (see `attachStageInfo` in students.service.ts), never inside
// `computeStageInfo` itself. CLOSED is deliberately NOT folded here (unlike before) — it
// gets its own "Report Downloaded" row (see STAGE_LABELS.CLOSED above) rather than
// reading as "Feedback — Parent" (still pending) for a case that's actually finished.
const REPORT_LABEL_FOLD: Partial<Record<DerivedStage, DerivedStage>> = {
  ASSESSMENT_PENDING: "PRE_COUNSELLING_PARENT",
  COUNSELLOR_FEEDBACK: "COUNSELLOR_FEEDBACK_REPORT",
  FEEDBACK_PENDING: "SESSION_2_COMPLETED",
};

export function reportStageLabel(stage: DerivedStage): string {
  const folded = REPORT_LABEL_FOLD[stage];
  return STAGE_LABELS[folded ?? stage];
}

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
// sessionNumber/endTime/*JoinedAt are optional so a test fixture built before the
// live-completion check existed still type-checks unchanged — findActiveSession/
// isSessionLiveCompleted below treat a missing field as "can't tell, so not completed",
// which is exactly the old behaviour those fixtures already expect.
type SessionRow = {
  sessionNumber?: string;
  status: string;
  scheduledDate: Date;
  endTime?: string;
  studentJoinedAt?: Date | null;
  counsellorJoinedAt?: Date | null;
  studentNoShow: boolean;
};

export interface StudentForStage {
  workflowStatus: WorkflowStatus;
  createdAt: Date;
  updatedAt: Date;
  isDiscontinued: boolean;
  discontinuedAt: Date | null;
  formSubmissions: SubmittedForm[];
  assessmentAttempts: AttemptRow[];
  sessions: SessionRow[];
  user: { passwordChangedAt: Date | null };
}

// Prisma include fragment that loads exactly the child fields the resolver needs (and no
// more). Spread into a findMany/findUnique alongside the display include, then stripped
// from the response by the caller.
export const stageRelationsInclude = {
  formSubmissions: {
    select: { submittedAt: true, formTemplate: { select: { formType: true } } },
  },
  assessmentAttempts: { select: { status: true, submittedAt: true } },
  sessions: {
    select: {
      sessionNumber: true,
      status: true,
      scheduledDate: true,
      endTime: true,
      studentJoinedAt: true,
      counsellorJoinedAt: true,
      studentNoShow: true,
    },
  },
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

// Nothing in the product ever calls POST /sessions/{id}/complete, so a real session's
// `status`/`workflowStatus` stays SCHEDULED forever once it's over — the admin dashboard
// can't wait on that write. Instead, treat a session as done, purely for *display* here
// (no DB write, same "computed live, never persisted" approach as the ageing flag above),
// once BOTH sides have actually joined it AND its scheduled end time has passed. A session
// only one side joined, or that hasn't ended yet, stays whatever workflowStatus says.
function isSessionLiveCompleted(session: SessionRow, now: Date): boolean {
  if (session.status !== "SCHEDULED") return session.status === "COMPLETED";
  if (!session.endTime || !session.studentJoinedAt || !session.counsellorJoinedAt) return false;
  return combineDateTime(session.scheduledDate, session.endTime) <= now;
}

function findActiveSession(sessions: SessionRow[], sessionNumber: "SESSION_1" | "SESSION_2"): SessionRow | undefined {
  return sessions.find((s) => s.sessionNumber === sessionNumber && s.status !== "CANCELLED");
}

// Only called on a session isSessionLiveCompleted already confirmed complete, so endTime
// is guaranteed present — narrows the optional field without an unsafe `!` at each call site.
function sessionCompletionClock(session: SessionRow): Date {
  return combineDateTime(session.scheduledDate, session.endTime!);
}

type Resolved = { stage: DerivedStage; actionable: boolean; clock: Date };

// The two feedback-form stages the admin report has rows for are FEEDBACK_STUDENT and
// FEEDBACK_PARENT — there's no separate row for "both submitted", so once both are in,
// the parent's submission is what determines the row (it's listed after Feedback —
// Student, so it reads as "further along"). Returns null when neither has submitted yet,
// so callers can fall back to their own workflowStatus-appropriate default.
function feedbackSubStage(fbStudent: Date | null, fbParent: Date | null): Resolved | null {
  if (fbParent) return { stage: "FEEDBACK_PARENT", actionable: true, clock: fbParent };
  if (fbStudent) return { stage: "FEEDBACK_STUDENT", actionable: true, clock: fbStudent };
  return null;
}

// Maps workflowStatus + sub-state → the displayed stage, whether it awaits a student/
// parent action (ageing-flaggable), and the timestamp the age is measured from. At
// PROFILE_COMPLETED the workflow only advances once BOTH pre-counselling forms are in, so
// at most one is present here; likewise the feedback split.
function resolveStage(s: StudentForStage, now: Date): Resolved {
  const preStudent = firstSubmittedAt(s.formSubmissions, "PRE_COUNSELLING_STUDENT");
  const preParent = firstSubmittedAt(s.formSubmissions, "PRE_COUNSELLING_PARENT");
  const fbStudent = firstSubmittedAt(s.formSubmissions, "FEEDBACK_STUDENT");
  const fbParent = firstSubmittedAt(s.formSubmissions, "FEEDBACK_PARENT");

  switch (s.workflowStatus) {
    case "DRAFT":
      // Credentials issued but no successful login/password change yet vs. logged in
      // (password changed) but profile not yet confirmed. `passwordChangedAt` is the
      // authoritative "did it happen" signal — see User.passwordChangedAt.
      if (!s.user.passwordChangedAt) {
        return { stage: "INVITED", actionable: true, clock: s.createdAt };
      }
      return { stage: "LOGIN_ACTIVATED", actionable: true, clock: s.user.passwordChangedAt };

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
    // missed-session check below supplies the flag instead. workflowStatus lags behind
    // real attendance here (see isSessionLiveCompleted) — check whether a session that
    // workflowStatus doesn't yet know about has actually wrapped up, so the admin view
    // doesn't sit on a stale "Session Booked"/"Session 1 Completed" indefinitely.
    case "SESSION_SCHEDULED": {
      const session1 = findActiveSession(s.sessions, "SESSION_1");
      const session2 = findActiveSession(s.sessions, "SESSION_2");
      if (session1 && isSessionLiveCompleted(session1, now) && session2 && isSessionLiveCompleted(session2, now)) {
        return { stage: "SESSION_2_COMPLETED", actionable: false, clock: sessionCompletionClock(session2) };
      }
      if (session1 && isSessionLiveCompleted(session1, now)) {
        return { stage: "SESSION_1_COMPLETED", actionable: false, clock: sessionCompletionClock(session1) };
      }
      return { stage: "SESSION_BOOKED", actionable: false, clock: s.updatedAt };
    }
    case "SESSION_1_COMPLETED": {
      const session2 = findActiveSession(s.sessions, "SESSION_2");
      if (session2 && isSessionLiveCompleted(session2, now)) {
        return { stage: "SESSION_2_COMPLETED", actionable: false, clock: sessionCompletionClock(session2) };
      }
      return { stage: "SESSION_1_COMPLETED", actionable: false, clock: s.updatedAt };
    }
    case "COUNSELLOR_FEEDBACK_REPORT":
      return { stage: "COUNSELLOR_FEEDBACK_REPORT", actionable: false, clock: s.updatedAt };
    // Submitting one feedback form alone advances nothing in forms.service.ts (FORM_PAIRS
    // — workflowStatus only reaches STUDENT_PARENT_FEEDBACK once BOTH are in), so this is
    // the ONLY workflowStatus a student can be at while exactly one side has submitted —
    // without checking fbStudent/fbParent here (mirroring the PROFILE_COMPLETED/
    // pre-counselling split above), a student's already-submitted feedback form was
    // invisible to admin, still showing "Session 2 Completed" until the other side caught
    // up too. Parent wins if both happen to already be in (see the shared helper below).
    case "SESSION_2_COMPLETED":
      return feedbackSubStage(fbStudent, fbParent) ?? { stage: "SESSION_2_COMPLETED", actionable: false, clock: s.updatedAt };
    case "COUNSELLOR_FEEDBACK":
      return { stage: "COUNSELLOR_FEEDBACK", actionable: false, clock: s.updatedAt };

    // Both feedback forms are already in by the time workflowStatus reaches this stage
    // under the normal flow (see FORM_PAIRS above), so feedbackSubStage's "parent wins"
    // rule below is what actually fires here in practice — not the "only one submitted"
    // case, which is really only reachable via an admin's manual workflow-status override
    // that bypasses the pairing gate. FEEDBACK_PENDING (neither submitted) is that same
    // override's other edge case.
    case "STUDENT_PARENT_FEEDBACK":
      return feedbackSubStage(fbStudent, fbParent) ?? { stage: "FEEDBACK_PENDING", actionable: true, clock: s.updatedAt };

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
      // A day-old still-SCHEDULED row usually means missed — unless both sides actually
      // joined it and it's simply waiting on the never-called /complete (see
      // isSessionLiveCompleted): that's a completed session, not a missed one, and
      // shouldn't red-flag a student whose stage now correctly shows it as done.
      (sn.status === "SCHEDULED" && istDayNumber(sn.scheduledDate) < today && !isSessionLiveCompleted(sn, now))
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

  const { stage, actionable, clock } = resolveStage(s, now);
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
