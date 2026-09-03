// The two scheduled jobs, as plain async functions (no cron here — see ./index.ts).
// Exported and parameterised (`now`, optional `projectId` scope) so they can be called
// directly from tests or a future manual-trigger endpoint.
//
// Idempotency is by send-side timestamps written after a successful send:
//   • session day reminders  → Session.dayReminderSentAt
//   • follow-up nudges        → Student.lastNudgeAt (throttled by IDLE_NUDGE_COOLDOWN_DAYS)
// The ageing/flag decision itself stays derived (computeStageInfo) — nothing about
// "who is idle" is persisted.

import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { sendTemplateEmail } from "../modules/email/email.service.js";
import type { EmailTemplateKey } from "../modules/email/templates/index.js";
import { formatDisplayDate } from "../common/utils/dateFormat.js";
import { calendarDaysBetween, istDateUtcMidnight, istDayNumber } from "../common/utils/istDate.js";
import {
  computeStageInfo,
  stageRelationsInclude,
  type DerivedStage,
  type FlagReason,
} from "../modules/students/studentStage.js";

export interface JobScope {
  projectId?: string; // limit to one project (used by tests / future per-project runs)
}

// Never let one failed email abort the batch — log and continue.
async function sendBestEffort(to: string, key: EmailTemplateKey, data: unknown): Promise<boolean> {
  try {
    await sendTemplateEmail(to, key, data);
    return true;
  } catch (err) {
    console.error(`[scheduler] email ${key} → ${to} failed:`, (err as Error).message);
    return false;
  }
}

// --- Job A: same-day session reminders -------------------------------------------------

export async function runSessionDayReminders(
  now: Date = new Date(),
  scope: JobScope = {}
): Promise<{ remindersSent: number }> {
  const today = istDateUtcMidnight(now); // matches @db.Date storage for "today in IST"
  const sessions = await prisma.session.findMany({
    where: {
      status: "SCHEDULED",
      scheduledDate: today,
      dayReminderSentAt: null,
      ...(scope.projectId ? { student: { projectId: scope.projectId } } : {}),
    },
    include: {
      student: { select: { parentEmail: true, user: { select: { firstName: true, lastName: true, email: true } } } },
      counsellor: { select: { user: { select: { firstName: true, lastName: true, email: true } } } },
    },
  });

  let remindersSent = 0;
  for (const s of sessions) {
    const studentName = `${s.student.user.firstName} ${s.student.user.lastName}`;
    const counsellorName = `${s.counsellor.user.firstName} ${s.counsellor.user.lastName}`;
    const n = s.sessionNumber === "SESSION_1" ? "1" : "2";
    // One payload for all three recipients — each template's Zod schema keeps only the
    // fields it declares (z.object strips the rest).
    const data = {
      studentName,
      counsellorName,
      parentName: "Parent",
      sessionTime: s.startTime,
      portalLink: env.APP_WEB_URL,
    };

    await sendBestEffort(s.student.user.email, `SESSION_${n}_DAY_REMINDER_STUDENT` as EmailTemplateKey, data);
    await sendBestEffort(s.student.parentEmail, `SESSION_${n}_DAY_REMINDER_PARENT` as EmailTemplateKey, data);
    await sendBestEffort(s.counsellor.user.email, `SESSION_${n}_DAY_REMINDER_COUNSELLOR` as EmailTemplateKey, data);

    await prisma.session.update({ where: { id: s.id }, data: { dayReminderSentAt: now } });
    remindersSent++;
  }

  return { remindersSent };
}

// --- Job B: follow-up nudges for flagged students --------------------------------------

type NudgePlan = { student: EmailTemplateKey; parent: EmailTemplateKey };

// Maps a flagged student's derived stage → the student+parent reminder templates. This is
// product copy routing; adjust here if the desired template for a stage changes. Returns
// null for stages that shouldn't be nudged.
function resolveNudgeTemplates(stage: DerivedStage, reason: FlagReason | null): NudgePlan | null {
  if (reason === "MISSED_SESSION") {
    return { student: "SESSION_MISSED_STUDENT", parent: "SESSION_MISSED_PARENT" };
  }
  switch (stage) {
    case "INVITED": // not logged in yet
      return { student: "LOGIN_ACTIVATION_REMINDER_STUDENT", parent: "LOGIN_ACTIVATION_REMINDER_PARENT" };
    case "LOGIN_ACTIVATED": // logged in, profile not confirmed
      return { student: "PROFILE_COMPLETION_REMINDER_STUDENT", parent: "PROFILE_COMPLETION_REMINDER_PARENT" };
    case "PROFILE_COMPLETED": // profile done, both pre-counselling forms pending
      return { student: "PRE_COUNSELLING_STUDENT_FORM_REMINDER_STUDENT", parent: "PRE_COUNSELLING_PARENT_FORM_REMINDER_PARENT" };
    case "PRE_COUNSELLING_STUDENT": // student's form in, parent's pending
      return { student: "PRE_COUNSELLING_PARENT_FORM_REMINDER_STUDENT", parent: "PRE_COUNSELLING_PARENT_FORM_REMINDER_PARENT" };
    case "PRE_COUNSELLING_PARENT": // parent's form in, student's pending
      return { student: "PRE_COUNSELLING_STUDENT_FORM_REMINDER_STUDENT", parent: "PRE_COUNSELLING_STUDENT_FORM_REMINDER_PARENT" };
    case "ASSESSMENT_PENDING":
      return { student: "ASSESSMENT_REMINDER_STUDENT", parent: "ASSESSMENT_REMINDER_PARENT" };
    case "ASSESSMENT_COMPLETED": // needs to book a session
      return { student: "SESSION_SCHEDULING_REMINDER_STUDENT", parent: "SESSION_SCHEDULING_REMINDER_PARENT" };
    case "FEEDBACK_STUDENT": // student feedback in, parent's pending
      return { student: "FEEDBACK_PARENT_PENDING_REMINDER_STUDENT", parent: "FEEDBACK_PARENT_PENDING_REMINDER_PARENT" };
    case "FEEDBACK_PARENT": // parent feedback in, student's pending
      return { student: "FEEDBACK_STUDENT_PENDING_REMINDER_STUDENT", parent: "FEEDBACK_STUDENT_PENDING_REMINDER_PARENT" };
    case "FEEDBACK_PENDING":
      return { student: "FEEDBACK_STUDENT_PENDING_REMINDER_STUDENT", parent: "FEEDBACK_PARENT_PENDING_REMINDER_PARENT" };
    default:
      return null; // SESSION_*/CLOSED etc. — not idle-nudged
  }
}

export async function runFollowUpNudges(
  now: Date = new Date(),
  scope: JobScope = {},
  cooldownDays: number = env.IDLE_NUDGE_COOLDOWN_DAYS
): Promise<{ nudgesSent: number }> {
  const students = await prisma.student.findMany({
    where: {
      workflowStatus: { not: "CLOSED" },
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
    },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, passwordChangedAt: true } },
      ...stageRelationsInclude,
    },
  });

  let nudgesSent = 0;
  for (const s of students) {
    const info = computeStageInfo(s, now);
    if (!info.flagged) continue;
    // Cooldown: don't re-nudge within the throttle window.
    if (s.lastNudgeAt && calendarDaysBetween(s.lastNudgeAt, now) < cooldownDays) continue;

    const plan = resolveNudgeTemplates(info.stage, info.flagReason);
    if (!plan) continue;

    // Missed-session copy wants the session date; find the offending session.
    const missed = s.sessions.find(
      (sn) => sn.studentNoShow || (sn.status === "SCHEDULED" && istDayNumber(sn.scheduledDate) < istDayNumber(now))
    );
    const data = {
      studentName: `${s.user.firstName} ${s.user.lastName}`,
      parentName: "Parent",
      sessionDateTime: missed ? formatDisplayDate(missed.scheduledDate) : "your recent session",
      portalLink: env.APP_WEB_URL,
      loginLink: env.APP_WEB_URL,
      formLink: env.APP_WEB_URL,
      feedbackFormLink: env.APP_WEB_URL,
    };

    const sentStudent = await sendBestEffort(s.user.email, plan.student, data);
    const sentParent = await sendBestEffort(s.parentEmail, plan.parent, data);
    if (sentStudent || sentParent) {
      await prisma.student.update({ where: { id: s.id }, data: { lastNudgeAt: now } });
      nudgesSent++;
    }
  }

  return { nudgesSent };
}

// The full daily batch the cron fires.
export async function runDailyBatch(
  now: Date = new Date(),
  scope: JobScope = {}
): Promise<{ remindersSent: number; nudgesSent: number }> {
  const reminders = await runSessionDayReminders(now, scope);
  const nudges = await runFollowUpNudges(now, scope);
  return { ...reminders, ...nudges };
}
