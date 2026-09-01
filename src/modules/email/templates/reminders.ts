import { z } from "zod";
import { button, paragraph, renderLayout } from "./layout.js";

// The 10 "+2 days if incomplete" nudge reminders and 4 one-time session status
// notifications from docs/Class 910_Workflow Prompts for Watsapp.xlsx (rows 3-16 —
// rows 1, 2 and 17 already have their own rich templates elsewhere in this
// directory). That sheet is WhatsApp copy; these are the email equivalents — no
// WhatsApp sending is implemented, per the PWC-backend scope for this pass.
//
// All 28 entries share the same shape (a plain-text nudge, optionally with one CTA
// link), so they're built from one small factory instead of 28 hand-written files.

interface ReminderDefinition<Schema extends z.ZodTypeAny> {
  subject: string;
  schema: Schema;
  body: (data: z.infer<Schema>) => string;
  text: (data: z.infer<Schema>) => string;
}

function reminder<Schema extends z.ZodTypeAny>(def: ReminderDefinition<Schema>) {
  return {
    schema: def.schema,
    render: (data: z.infer<Schema>) => ({
      subject: def.subject,
      html: renderLayout(def.body(data)),
      text: def.text(data),
    }),
  };
}

const withLink = (message: string, ctaLabel?: string, ctaLink?: string): string =>
  [paragraph(message), ctaLabel && ctaLink ? button(ctaLabel, ctaLink) : ""].join("");

// --- Row 3: Password Change / Account Activation Reminder (+2 days if not logged in) ---

const loginActivationReminderStudentSchema = z.object({
  studentName: z.string().trim().min(1),
  loginLink: z.string().url().optional(),
});
export const LOGIN_ACTIVATION_REMINDER_STUDENT = reminder({
  subject: "Reminder: Activate Your kREATE Account",
  schema: loginActivationReminderStudentSchema,
  body: ({ studentName, loginLink }) =>
    withLink(
      `Hi ${studentName}, we noticed you haven't logged in yet. Please use the link in your email to activate your account and set a new password. This is the first step before we begin your counselling journey.`,
      "Activate My Account",
      loginLink
    ),
  text: ({ studentName }) =>
    `Hi ${studentName}, we noticed you haven't logged in yet. Please activate your account and set a new password to begin your counselling journey.`,
});

const loginActivationReminderParentSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
});
export const LOGIN_ACTIVATION_REMINDER_PARENT = reminder({
  subject: "Reminder: Activate Your kREATE Account",
  schema: loginActivationReminderParentSchema,
  body: ({ parentName, studentName }) =>
    paragraph(
      `Dear ${parentName}, ${studentName} hasn't logged in to activate their kREATE account yet. A gentle reminder to help ${studentName} do so, so we can stay on schedule.`
    ),
  text: ({ parentName, studentName }) =>
    `Dear ${parentName}, ${studentName} hasn't logged in to activate their kREATE account yet. A gentle reminder to help them do so, so we can stay on schedule.`,
});

// --- Row 4: Profile Completion Reminder (+2 days if profile incomplete) ---

const profileCompletionReminderStudentSchema = z.object({
  studentName: z.string().trim().min(1),
  portalLink: z.string().url().optional(),
});
export const PROFILE_COMPLETION_REMINDER_STUDENT = reminder({
  subject: "Reminder: Complete Your kREATE Profile",
  schema: profileCompletionReminderStudentSchema,
  body: ({ studentName, portalLink }) =>
    withLink(
      `Hi ${studentName}, please complete your profile form in your kREATE portal. This is needed before we can move ahead.`,
      "Complete My Profile",
      portalLink
    ),
  text: ({ studentName }) => `Hi ${studentName}, please complete your profile form in your kREATE portal.`,
});

const profileCompletionReminderParentSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
});
export const PROFILE_COMPLETION_REMINDER_PARENT = reminder({
  subject: "Reminder: Complete Your kREATE Profile",
  schema: profileCompletionReminderParentSchema,
  body: ({ parentName, studentName }) =>
    paragraph(
      `Dear ${parentName}, ${studentName}'s profile form is still pending. Kindly remind them to complete it soon so we can proceed to the next step.`
    ),
  text: ({ parentName, studentName }) =>
    `Dear ${parentName}, ${studentName}'s profile form is still pending. Kindly remind them to complete it soon.`,
});

// --- Row 5: Pre-Counselling Form — Student's Own Form Pending (+2 days) ---

const preCounsellingStudentFormReminderStudentSchema = z.object({
  studentName: z.string().trim().min(1),
  formLink: z.string().url().optional(),
});
export const PRE_COUNSELLING_STUDENT_FORM_REMINDER_STUDENT = reminder({
  subject: "Reminder: Your Pre-Counselling Form is Pending",
  schema: preCounsellingStudentFormReminderStudentSchema,
  body: ({ studentName, formLink }) =>
    withLink(
      `Hi ${studentName}, your pre-counselling form is still pending. Please complete it at your earliest so we can move ahead to the assessment.`,
      "Complete My Form",
      formLink
    ),
  text: ({ studentName }) =>
    `Hi ${studentName}, your pre-counselling form is still pending. Please complete it so we can move ahead to the assessment.`,
});

const preCounsellingStudentFormReminderParentSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
});
export const PRE_COUNSELLING_STUDENT_FORM_REMINDER_PARENT = reminder({
  subject: "Reminder: Pre-Counselling Form Pending",
  schema: preCounsellingStudentFormReminderParentSchema,
  body: ({ parentName, studentName }) =>
    paragraph(
      `Dear ${parentName}, ${studentName}'s pre-counselling form is still pending. A gentle reminder to encourage ${studentName} to complete it soon.`
    ),
  text: ({ parentName, studentName }) =>
    `Dear ${parentName}, ${studentName}'s pre-counselling form is still pending. Please encourage them to complete it soon.`,
});

// --- Row 6: Pre-Counselling Form — Parent's Form Pending (+2 days) ---

const preCounsellingParentFormReminderStudentSchema = z.object({
  studentName: z.string().trim().min(1),
});
export const PRE_COUNSELLING_PARENT_FORM_REMINDER_STUDENT = reminder({
  subject: "Reminder: Your Parent's Pre-Counselling Form is Pending",
  schema: preCounsellingParentFormReminderStudentSchema,
  body: ({ studentName }) =>
    paragraph(
      `Hi ${studentName}, your parent's pre-counselling form is still pending. Please remind them to complete it soon. It's a required step before your assessment can begin.`
    ),
  text: ({ studentName }) =>
    `Hi ${studentName}, your parent's pre-counselling form is still pending. It's a required step before your assessment can begin.`,
});

const preCounsellingParentFormReminderParentSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
  formLink: z.string().url().optional(),
});
export const PRE_COUNSELLING_PARENT_FORM_REMINDER_PARENT = reminder({
  subject: "Reminder: Your Pre-Counselling Form is Pending",
  schema: preCounsellingParentFormReminderParentSchema,
  body: ({ parentName, studentName, formLink }) =>
    withLink(
      `Dear ${parentName}, your pre-counselling form for ${studentName} is still pending. Please note this link is time-limited. Kindly complete it before it expires.`,
      "Complete My Form",
      formLink
    ),
  text: ({ parentName, studentName }) =>
    `Dear ${parentName}, your pre-counselling form for ${studentName} is still pending. This link is time-limited — please complete it before it expires.`,
});

// --- Row 7: Assessment Reminder (+2 days if assessment incomplete) ---

const assessmentReminderStudentSchema = z.object({
  studentName: z.string().trim().min(1),
  assessmentLink: z.string().url().optional(),
});
export const ASSESSMENT_REMINDER_STUDENT = reminder({
  subject: "Reminder: Your Career Assessment is Pending",
  schema: assessmentReminderStudentSchema,
  body: ({ studentName, assessmentLink }) =>
    withLink(
      `Hi ${studentName}, your assessment is still pending. Please complete it at your earliest convenience.`,
      "Take My Assessment",
      assessmentLink
    ),
  text: ({ studentName }) => `Hi ${studentName}, your assessment is still pending. Please complete it soon.`,
});

const assessmentReminderParentSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
});
export const ASSESSMENT_REMINDER_PARENT = reminder({
  subject: "Reminder: Assessment Pending",
  schema: assessmentReminderParentSchema,
  body: ({ parentName, studentName }) =>
    paragraph(
      `Dear ${parentName}, ${studentName}'s assessment is still pending. Kindly encourage ${studentName} to complete it soon.`
    ),
  text: ({ parentName, studentName }) =>
    `Dear ${parentName}, ${studentName}'s assessment is still pending. Kindly encourage them to complete it soon.`,
});

// --- Row 8: Session Scheduling Reminder (+2 days if scheduling incomplete) ---

const sessionSchedulingReminderStudentSchema = z.object({
  studentName: z.string().trim().min(1),
  schedulingLink: z.string().url().optional(),
});
export const SESSION_SCHEDULING_REMINDER_STUDENT = reminder({
  subject: "Reminder: Book Your Counselling Sessions",
  schema: sessionSchedulingReminderStudentSchema,
  body: ({ studentName, schedulingLink }) =>
    withLink(
      `Hi ${studentName}, you can now book your Session 1 & 2 slot. Please log in to the portal and choose a time that works for you.`,
      "Book My Sessions",
      schedulingLink
    ),
  text: ({ studentName }) => `Hi ${studentName}, you can now book your Session 1 & 2 slot. Please log in to the portal.`,
});

const sessionSchedulingReminderParentSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
});
export const SESSION_SCHEDULING_REMINDER_PARENT = reminder({
  subject: "Reminder: Counselling Sessions Ready to Book",
  schema: sessionSchedulingReminderParentSchema,
  body: ({ parentName, studentName }) =>
    paragraph(
      `Dear ${parentName}, ${studentName} can now book their counselling session. Kindly encourage ${studentName} to do this soon so we can plan ahead.`
    ),
  text: ({ parentName, studentName }) =>
    `Dear ${parentName}, ${studentName} can now book their counselling session. Please encourage them to do this soon.`,
});

// --- Row 9: Session Scheduling Confirmation (immediately after booking Session 1) ---

const sessionScheduledConfirmationStudentSchema = z.object({
  studentName: z.string().trim().min(1),
  sessionDateTime: z.string().trim().min(1),
  portalLink: z.string().url().optional(),
});
export const SESSION_SCHEDULED_CONFIRMATION_STUDENT = reminder({
  subject: "Your Session 1 is Confirmed",
  schema: sessionScheduledConfirmationStudentSchema,
  body: ({ studentName, sessionDateTime, portalLink }) =>
    withLink(
      `Hi ${studentName}, your Session 1 is confirmed for ${sessionDateTime}. Full details have been emailed to you. We look forward to speaking with you!`,
      "View My Session",
      portalLink
    ),
  text: ({ studentName, sessionDateTime }) =>
    `Hi ${studentName}, your Session 1 is confirmed for ${sessionDateTime}. We look forward to speaking with you!`,
});

const sessionScheduledConfirmationParentSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
  sessionDateTime: z.string().trim().min(1),
});
export const SESSION_SCHEDULED_CONFIRMATION_PARENT = reminder({
  subject: `Session 1 Confirmed`,
  schema: sessionScheduledConfirmationParentSchema,
  body: ({ parentName, studentName, sessionDateTime }) =>
    paragraph(
      `Dear ${parentName}, ${studentName} has booked Session 1 for ${sessionDateTime}. Details have been emailed to you as well.`
    ),
  text: ({ parentName, studentName, sessionDateTime }) =>
    `Dear ${parentName}, ${studentName} has booked Session 1 for ${sessionDateTime}.`,
});

// Not from the source WhatsApp sheet (that sheet only covers student/parent copy) —
// added for the Sessions module so the assigned counsellor gets notified too, in
// parity with the student/parent confirmation above.
const sessionScheduledConfirmationCounsellorSchema = z.object({
  counsellorName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
  sessionDateTime: z.string().trim().min(1),
  portalLink: z.string().url().optional(),
});
export const SESSION_SCHEDULED_CONFIRMATION_COUNSELLOR = reminder({
  subject: "New Session 1 Booking Assigned to You",
  schema: sessionScheduledConfirmationCounsellorSchema,
  body: ({ counsellorName, studentName, sessionDateTime, portalLink }) =>
    withLink(
      `Hi ${counsellorName}, you've been assigned Session 1 with ${studentName}, confirmed for ${sessionDateTime}. Session 2 will follow with the same student.`,
      "View My Sessions",
      portalLink
    ),
  text: ({ counsellorName, studentName, sessionDateTime }) =>
    `Hi ${counsellorName}, you've been assigned Session 1 with ${studentName}, confirmed for ${sessionDateTime}.`,
});

// --- Row 10 / 11: Session 1 / Session 2 — Day Reminder (same-day morning) ---

function sessionDayReminderStudent(sessionNumber: "1" | "2") {
  const schema = z.object({
    studentName: z.string().trim().min(1),
    sessionTime: z.string().trim().min(1),
    portalLink: z.string().url().optional(),
  });
  return reminder({
    subject: `Reminder: Your Session ${sessionNumber} is Today`,
    schema,
    body: ({ studentName, sessionTime, portalLink }) =>
      withLink(
        `Hi ${studentName}, just a reminder. Your Session ${sessionNumber} is today at ${sessionTime}. Please check your portal for the meeting link and join a few minutes early.`,
        "Join Session",
        portalLink
      ),
    text: ({ studentName, sessionTime }) =>
      `Hi ${studentName}, your Session ${sessionNumber} is today at ${sessionTime}. Please join a few minutes early.`,
  });
}

function sessionDayReminderParent(sessionNumber: "1" | "2") {
  const schema = z.object({
    parentName: z.string().trim().min(1),
    studentName: z.string().trim().min(1),
    sessionTime: z.string().trim().min(1),
  });
  return reminder({
    subject: `Reminder: ${sessionNumber === "1" ? "Session 1" : "Session 2"} Today`,
    schema,
    body: ({ parentName, studentName, sessionTime }) =>
      paragraph(
        `Dear ${parentName}, a reminder that ${studentName}'s Session ${sessionNumber} is today at ${sessionTime}. You are also expected to join with the link provided in the email a few minutes early.`
      ),
    text: ({ parentName, studentName, sessionTime }) =>
      `Dear ${parentName}, a reminder that ${studentName}'s Session ${sessionNumber} is today at ${sessionTime}.`,
  });
}

// Not from the source WhatsApp sheet — added for the Sessions module, sent to the
// parent when the student joins their session.
const sessionJoinedParentSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
  sessionNumber: z.enum(["1", "2"]),
});
export const SESSION_JOINED_PARENT = reminder({
  subject: "Your Child Has Joined Their Session",
  schema: sessionJoinedParentSchema,
  body: ({ parentName, studentName, sessionNumber }) =>
    paragraph(`Dear ${parentName}, ${studentName} has just joined Session ${sessionNumber}.`),
  text: ({ parentName, studentName, sessionNumber }) =>
    `Dear ${parentName}, ${studentName} has just joined Session ${sessionNumber}.`,
});

// Not from the source WhatsApp sheet — added for the Sessions module, same-day
// reminder to the assigned counsellor, in parity with the student/parent reminders.
function sessionDayReminderCounsellor(sessionNumber: "1" | "2") {
  const schema = z.object({
    counsellorName: z.string().trim().min(1),
    studentName: z.string().trim().min(1),
    sessionTime: z.string().trim().min(1),
    portalLink: z.string().url().optional(),
  });
  return reminder({
    subject: `Reminder: Session ${sessionNumber} is Today`,
    schema,
    body: ({ counsellorName, studentName, sessionTime, portalLink }) =>
      withLink(
        `Hi ${counsellorName}, a reminder that your Session ${sessionNumber} with ${studentName} is today at ${sessionTime}. Please check your portal for the meeting link and join a few minutes early.`,
        "View My Sessions",
        portalLink
      ),
    text: ({ counsellorName, studentName, sessionTime }) =>
      `Hi ${counsellorName}, your Session ${sessionNumber} with ${studentName} is today at ${sessionTime}.`,
  });
}

export const SESSION_1_DAY_REMINDER_STUDENT = sessionDayReminderStudent("1");
export const SESSION_1_DAY_REMINDER_PARENT = sessionDayReminderParent("1");
export const SESSION_1_DAY_REMINDER_COUNSELLOR = sessionDayReminderCounsellor("1");
export const SESSION_2_DAY_REMINDER_STUDENT = sessionDayReminderStudent("2");
export const SESSION_2_DAY_REMINDER_PARENT = sessionDayReminderParent("2");
export const SESSION_2_DAY_REMINDER_COUNSELLOR = sessionDayReminderCounsellor("2");

// --- Row 12: Session Rescheduled (whenever either party reschedules) ---

const sessionRescheduledStudentSchema = z.object({
  studentName: z.string().trim().min(1),
  sessionNumber: z.enum(["1", "2"]),
  newDateTime: z.string().trim().min(1),
  portalLink: z.string().url().optional(),
});
export const SESSION_RESCHEDULED_STUDENT = reminder({
  subject: "Your Session Has Been Rescheduled",
  schema: sessionRescheduledStudentSchema,
  body: ({ studentName, sessionNumber, newDateTime, portalLink }) =>
    withLink(
      `Hi ${studentName}, your session ${sessionNumber} has been rescheduled to ${newDateTime}. Please check your portal for the updated details.`,
      "View Updated Details",
      portalLink
    ),
  text: ({ studentName, sessionNumber, newDateTime }) =>
    `Hi ${studentName}, your session ${sessionNumber} has been rescheduled to ${newDateTime}.`,
});

const sessionRescheduledParentSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
  sessionNumber: z.enum(["1", "2"]),
  newDateTime: z.string().trim().min(1),
});
export const SESSION_RESCHEDULED_PARENT = reminder({
  subject: "Session Rescheduled",
  schema: sessionRescheduledParentSchema,
  body: ({ parentName, studentName, sessionNumber, newDateTime }) =>
    paragraph(`Dear ${parentName}, ${studentName}'s session ${sessionNumber} has been rescheduled to ${newDateTime}.`),
  text: ({ parentName, studentName, sessionNumber, newDateTime }) =>
    `Dear ${parentName}, ${studentName}'s session ${sessionNumber} has been rescheduled to ${newDateTime}.`,
});

// --- Row 13: Session Cancelled (whenever either party cancels) ---

const sessionCancelledStudentSchema = z.object({
  studentName: z.string().trim().min(1),
  sessionNumber: z.enum(["1", "2"]),
  originalDateTime: z.string().trim().min(1),
  portalLink: z.string().url().optional(),
});
export const SESSION_CANCELLED_STUDENT = reminder({
  subject: "Your Session Has Been Cancelled",
  schema: sessionCancelledStudentSchema,
  body: ({ studentName, sessionNumber, originalDateTime, portalLink }) =>
    withLink(
      `Hi ${studentName}, your session ${sessionNumber} scheduled for ${originalDateTime} has been cancelled. Please log in to the portal to book a new slot at your convenience.`,
      "Book a New Slot",
      portalLink
    ),
  text: ({ studentName, sessionNumber, originalDateTime }) =>
    `Hi ${studentName}, your session ${sessionNumber} scheduled for ${originalDateTime} has been cancelled. Please rebook at your convenience.`,
});

const sessionCancelledParentSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
  sessionNumber: z.enum(["1", "2"]),
  originalDateTime: z.string().trim().min(1),
});
export const SESSION_CANCELLED_PARENT = reminder({
  subject: "Session Cancelled",
  schema: sessionCancelledParentSchema,
  body: ({ parentName, studentName, sessionNumber, originalDateTime }) =>
    paragraph(
      `Dear ${parentName}, ${studentName}'s session ${sessionNumber} scheduled for ${originalDateTime} has been cancelled. Kindly encourage them to rebook at the earliest.`
    ),
  text: ({ parentName, studentName, sessionNumber, originalDateTime }) =>
    `Dear ${parentName}, ${studentName}'s session ${sessionNumber} scheduled for ${originalDateTime} has been cancelled.`,
});

// --- Row 14: Session Missed / No-show (same day, post no-show) ---

const sessionMissedStudentSchema = z.object({
  studentName: z.string().trim().min(1),
  sessionDateTime: z.string().trim().min(1),
  portalLink: z.string().url().optional(),
});
export const SESSION_MISSED_STUDENT = reminder({
  subject: "We Missed You Today",
  schema: sessionMissedStudentSchema,
  body: ({ studentName, sessionDateTime, portalLink }) =>
    withLink(
      `Hi ${studentName}, we missed you at today's session (${sessionDateTime}). Please log in to the portal to rebook at the earliest so we can keep your counselling journey on track.`,
      "Rebook My Session",
      portalLink
    ),
  text: ({ studentName, sessionDateTime }) =>
    `Hi ${studentName}, we missed you at today's session (${sessionDateTime}). Please rebook at the earliest.`,
});

const sessionMissedParentSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
  sessionDateTime: z.string().trim().min(1),
});
export const SESSION_MISSED_PARENT = reminder({
  subject: "Session Missed Today",
  schema: sessionMissedParentSchema,
  body: ({ parentName, studentName, sessionDateTime }) =>
    paragraph(
      `Dear ${parentName}, ${studentName} missed their scheduled session today (${sessionDateTime}). Kindly encourage ${studentName} to rebook soon.`
    ),
  text: ({ parentName, studentName, sessionDateTime }) =>
    `Dear ${parentName}, ${studentName} missed their scheduled session today (${sessionDateTime}). Please encourage them to rebook soon.`,
});

// --- No-show tracking (Cancellation, Rescheduling & No-Show Process Note) ---
// Not in the original 31-row reminder sheet — added when explicit no-show marking
// (POST /sessions/:id/no-show) was built. Two admin alerts (one per party) plus an
// apology sent straight to the student when the *counsellor* is the no-show, since
// SESSION_MISSED_STUDENT's "we missed you" framing would wrongly imply the student
// was at fault — that template is reused as-is for the student-no-show reschedule
// prompt (sent once Admin permits it), where the framing is correct.

const sessionStudentNoShowAdminSchema = z.object({
  studentName: z.string().trim().min(1),
  counsellorName: z.string().trim().min(1),
  sessionNumber: z.enum(["1", "2"]),
  sessionDateTime: z.string().trim().min(1),
});
export const SESSION_STUDENT_NO_SHOW_ADMIN = reminder({
  subject: "Student No-Show Flagged",
  schema: sessionStudentNoShowAdminSchema,
  body: ({ studentName, counsellorName, sessionNumber, sessionDateTime }) =>
    paragraph(
      `${studentName} was marked as not having joined session ${sessionNumber} with ${counsellorName}, scheduled for ${sessionDateTime}. Once you're ready, permit the reschedule prompt to be sent to the student.`
    ),
  text: ({ studentName, counsellorName, sessionNumber, sessionDateTime }) =>
    `${studentName} was marked as not having joined session ${sessionNumber} with ${counsellorName}, scheduled for ${sessionDateTime}.`,
});

const sessionCounsellorNoShowAdminSchema = z.object({
  studentName: z.string().trim().min(1),
  counsellorName: z.string().trim().min(1),
  sessionNumber: z.enum(["1", "2"]),
  sessionDateTime: z.string().trim().min(1),
});
export const SESSION_COUNSELLOR_NO_SHOW_ADMIN = reminder({
  subject: "Counsellor No-Show — Action Required",
  schema: sessionCounsellorNoShowAdminSchema,
  body: ({ studentName, counsellorName, sessionNumber, sessionDateTime }) =>
    paragraph(
      `${counsellorName} did not join session ${sessionNumber} with ${studentName}, scheduled for ${sessionDateTime}. The student has already been sent an apology and reschedule prompt automatically. Please review this counsellor's availability record.`
    ),
  text: ({ studentName, counsellorName, sessionNumber, sessionDateTime }) =>
    `${counsellorName} did not join session ${sessionNumber} with ${studentName}, scheduled for ${sessionDateTime}. The student has already been notified.`,
});

const sessionCounsellorNoShowStudentSchema = z.object({
  studentName: z.string().trim().min(1),
  sessionDateTime: z.string().trim().min(1),
  portalLink: z.string().url().optional(),
});
export const SESSION_COUNSELLOR_NO_SHOW_STUDENT = reminder({
  subject: "We're Sorry We Missed You",
  schema: sessionCounsellorNoShowStudentSchema,
  body: ({ studentName, sessionDateTime, portalLink }) =>
    withLink(
      `Hi ${studentName}, we're sorry — your counsellor was unable to join your session scheduled for ${sessionDateTime}. This was on us, not you. Please log in to the portal to pick a new time that works for you.`,
      "Rebook My Session",
      portalLink
    ),
  text: ({ studentName, sessionDateTime }) =>
    `Hi ${studentName}, we're sorry — your counsellor was unable to join your session scheduled for ${sessionDateTime}. Please rebook at your convenience.`,
});

// --- Counsellor-initiated reschedule (same doc, §3) ---
// Not in either source sheet — added alongside the no-show templates above.

const sessionCounsellorRescheduleRequestStudentSchema = z.object({
  studentName: z.string().trim().min(1),
  sessionNumber: z.enum(["1", "2"]),
  reason: z.string().trim().min(1),
  proposedDateTime: z.string().trim().min(1),
  portalLink: z.string().url().optional(),
});
export const SESSION_COUNSELLOR_RESCHEDULE_REQUEST_STUDENT = reminder({
  subject: "Your Counsellor Needs to Reschedule",
  schema: sessionCounsellorRescheduleRequestStudentSchema,
  body: ({ studentName, sessionNumber, reason, proposedDateTime, portalLink }) =>
    withLink(
      `Hi ${studentName}, your counsellor needs to reschedule session ${sessionNumber} (${reason}). They've proposed a new time: ${proposedDateTime}. Please log in to the portal to accept it or let us know if it doesn't work.`,
      "Review Proposed Time",
      portalLink
    ),
  text: ({ studentName, sessionNumber, reason, proposedDateTime }) =>
    `Hi ${studentName}, your counsellor needs to reschedule session ${sessionNumber} (${reason}). Proposed new time: ${proposedDateTime}.`,
});

// --- Row 15: Feedback Reminder — Student Pending (+2 days) ---

const feedbackStudentPendingReminderStudentSchema = z.object({
  studentName: z.string().trim().min(1),
  feedbackFormLink: z.string().url().optional(),
});
export const FEEDBACK_STUDENT_PENDING_REMINDER_STUDENT = reminder({
  subject: "Reminder: Your Feedback Form is Pending",
  schema: feedbackStudentPendingReminderStudentSchema,
  body: ({ studentName, feedbackFormLink }) =>
    withLink(
      `Hi ${studentName}, please complete your feedback form. This is the last step before your final Career kREATE Report is unlocked for download.`,
      "Complete My Feedback",
      feedbackFormLink
    ),
  text: ({ studentName }) =>
    `Hi ${studentName}, please complete your feedback form — the last step before your report is unlocked.`,
});

const feedbackStudentPendingReminderParentSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
});
export const FEEDBACK_STUDENT_PENDING_REMINDER_PARENT = reminder({
  subject: "Reminder: Feedback Form Pending",
  schema: feedbackStudentPendingReminderParentSchema,
  body: ({ parentName, studentName }) =>
    paragraph(`Dear ${parentName}, ${studentName}'s feedback form is still pending. Kindly remind ${studentName} to complete it soon.`),
  text: ({ parentName, studentName }) =>
    `Dear ${parentName}, ${studentName}'s feedback form is still pending. Kindly remind them to complete it soon.`,
});

// --- Row 16: Feedback Reminder — Parent Pending (+2 days) ---

const feedbackParentPendingReminderStudentSchema = z.object({
  studentName: z.string().trim().min(1),
});
export const FEEDBACK_PARENT_PENDING_REMINDER_STUDENT = reminder({
  subject: "Reminder: Your Parent's Feedback Form is Pending",
  schema: feedbackParentPendingReminderStudentSchema,
  body: ({ studentName }) =>
    paragraph(
      `Hi ${studentName}, your parent's feedback form is still pending. Please remind them. The Career kREATE Report will only unlock once both forms are submitted.`
    ),
  text: ({ studentName }) =>
    `Hi ${studentName}, your parent's feedback form is still pending. The report unlocks once both forms are submitted.`,
});

const feedbackParentPendingReminderParentSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
  feedbackFormLink: z.string().url().optional(),
});
export const FEEDBACK_PARENT_PENDING_REMINDER_PARENT = reminder({
  subject: "Reminder: Your Feedback Form is Pending",
  schema: feedbackParentPendingReminderParentSchema,
  body: ({ parentName, studentName, feedbackFormLink }) =>
    withLink(
      `Dear ${parentName}, your feedback form for ${studentName}'s counselling programme is still pending. Please complete it soon. The final Career kREATE Report is released only once both feedback forms are submitted.`,
      "Complete My Feedback",
      feedbackFormLink
    ),
  text: ({ parentName, studentName }) =>
    `Dear ${parentName}, your feedback form for ${studentName}'s counselling programme is still pending. The report releases once both forms are submitted.`,
});
