import type { z } from "zod";
import { feedbackRequestParentDataSchema, renderFeedbackRequestParentEmail } from "./feedback-request-parent.js";
import { loginCredentialsParentDataSchema, renderLoginCredentialsParentEmail } from "./login-credentials-parent.js";
import { loginCredentialsStudentDataSchema, renderLoginCredentialsStudentEmail } from "./login-credentials-student.js";
import { passwordResetDataSchema, renderPasswordResetEmail } from "./password-reset.js";
import { preCounsellingParentDataSchema, renderPreCounsellingParentEmail } from "./pre-counselling-parent.js";
import * as reminders from "./reminders.js";
import { renderReportReadyParentEmail, reportReadyParentDataSchema } from "./report-ready-parent.js";
import { renderReportReadyStudentEmail, reportReadyStudentDataSchema } from "./report-ready-student.js";
import { renderSessionDetailsParentEmail, sessionDetailsParentDataSchema } from "./session-details-parent.js";
import { renderWelcomeParentEmail, welcomeParentDataSchema } from "./welcome-parent.js";
import { renderWelcomeStudentEmail, welcomeStudentDataSchema } from "./welcome-student.js";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// One entry per kREATE communication template: the 9 rich lifecycle templates from
// docs/11.Class 910_Communication EMail Templates.pdf, the 31 reminder/session-status
// templates (email equivalents of docs/Class 910_Workflow Prompts for Watsapp.xlsx rows
// 3-16 — that sheet is WhatsApp copy; WhatsApp sending itself isn't implemented), plus 4
// no-show/reschedule-tracking templates added for docs/Session Handling_Cancellation
// Rescheduling.pdf (not in either source sheet). Each entry pairs the Zod schema that validates the
// template's merge data with the function that renders subject/html/text from it. See
// src/modules/email/README.md for the full reference.
export const emailTemplateRegistry = {
  WELCOME_STUDENT: { schema: welcomeStudentDataSchema, render: renderWelcomeStudentEmail },
  WELCOME_PARENT: { schema: welcomeParentDataSchema, render: renderWelcomeParentEmail },
  LOGIN_CREDENTIALS_STUDENT: { schema: loginCredentialsStudentDataSchema, render: renderLoginCredentialsStudentEmail },
  LOGIN_CREDENTIALS_PARENT: { schema: loginCredentialsParentDataSchema, render: renderLoginCredentialsParentEmail },
  PASSWORD_RESET: { schema: passwordResetDataSchema, render: renderPasswordResetEmail },
  PRE_COUNSELLING_PARENT: { schema: preCounsellingParentDataSchema, render: renderPreCounsellingParentEmail },
  SESSION_DETAILS_PARENT: { schema: sessionDetailsParentDataSchema, render: renderSessionDetailsParentEmail },
  FEEDBACK_REQUEST_PARENT: { schema: feedbackRequestParentDataSchema, render: renderFeedbackRequestParentEmail },
  REPORT_READY_STUDENT: { schema: reportReadyStudentDataSchema, render: renderReportReadyStudentEmail },
  REPORT_READY_PARENT: { schema: reportReadyParentDataSchema, render: renderReportReadyParentEmail },

  LOGIN_ACTIVATION_REMINDER_STUDENT: reminders.LOGIN_ACTIVATION_REMINDER_STUDENT,
  LOGIN_ACTIVATION_REMINDER_PARENT: reminders.LOGIN_ACTIVATION_REMINDER_PARENT,
  PROFILE_COMPLETION_REMINDER_STUDENT: reminders.PROFILE_COMPLETION_REMINDER_STUDENT,
  PROFILE_COMPLETION_REMINDER_PARENT: reminders.PROFILE_COMPLETION_REMINDER_PARENT,
  PRE_COUNSELLING_STUDENT_FORM_REMINDER_STUDENT: reminders.PRE_COUNSELLING_STUDENT_FORM_REMINDER_STUDENT,
  PRE_COUNSELLING_STUDENT_FORM_REMINDER_PARENT: reminders.PRE_COUNSELLING_STUDENT_FORM_REMINDER_PARENT,
  PRE_COUNSELLING_PARENT_FORM_REMINDER_STUDENT: reminders.PRE_COUNSELLING_PARENT_FORM_REMINDER_STUDENT,
  PRE_COUNSELLING_PARENT_FORM_REMINDER_PARENT: reminders.PRE_COUNSELLING_PARENT_FORM_REMINDER_PARENT,
  ASSESSMENT_REMINDER_STUDENT: reminders.ASSESSMENT_REMINDER_STUDENT,
  ASSESSMENT_REMINDER_PARENT: reminders.ASSESSMENT_REMINDER_PARENT,
  SESSION_SCHEDULING_REMINDER_STUDENT: reminders.SESSION_SCHEDULING_REMINDER_STUDENT,
  SESSION_SCHEDULING_REMINDER_PARENT: reminders.SESSION_SCHEDULING_REMINDER_PARENT,
  SESSION_SCHEDULED_CONFIRMATION_STUDENT: reminders.SESSION_SCHEDULED_CONFIRMATION_STUDENT,
  SESSION_SCHEDULED_CONFIRMATION_PARENT: reminders.SESSION_SCHEDULED_CONFIRMATION_PARENT,
  SESSION_SCHEDULED_CONFIRMATION_COUNSELLOR: reminders.SESSION_SCHEDULED_CONFIRMATION_COUNSELLOR,
  SESSION_1_DAY_REMINDER_STUDENT: reminders.SESSION_1_DAY_REMINDER_STUDENT,
  SESSION_1_DAY_REMINDER_PARENT: reminders.SESSION_1_DAY_REMINDER_PARENT,
  SESSION_1_DAY_REMINDER_COUNSELLOR: reminders.SESSION_1_DAY_REMINDER_COUNSELLOR,
  SESSION_2_DAY_REMINDER_STUDENT: reminders.SESSION_2_DAY_REMINDER_STUDENT,
  SESSION_2_DAY_REMINDER_PARENT: reminders.SESSION_2_DAY_REMINDER_PARENT,
  SESSION_2_DAY_REMINDER_COUNSELLOR: reminders.SESSION_2_DAY_REMINDER_COUNSELLOR,
  SESSION_JOINED_PARENT: reminders.SESSION_JOINED_PARENT,
  SESSION_RESCHEDULED_STUDENT: reminders.SESSION_RESCHEDULED_STUDENT,
  SESSION_RESCHEDULED_PARENT: reminders.SESSION_RESCHEDULED_PARENT,
  SESSION_CANCELLED_STUDENT: reminders.SESSION_CANCELLED_STUDENT,
  SESSION_CANCELLED_PARENT: reminders.SESSION_CANCELLED_PARENT,
  SESSION_MISSED_STUDENT: reminders.SESSION_MISSED_STUDENT,
  SESSION_MISSED_PARENT: reminders.SESSION_MISSED_PARENT,
  SESSION_STUDENT_NO_SHOW_ADMIN: reminders.SESSION_STUDENT_NO_SHOW_ADMIN,
  SESSION_COUNSELLOR_NO_SHOW_ADMIN: reminders.SESSION_COUNSELLOR_NO_SHOW_ADMIN,
  SESSION_COUNSELLOR_NO_SHOW_STUDENT: reminders.SESSION_COUNSELLOR_NO_SHOW_STUDENT,
  SESSION_COUNSELLOR_RESCHEDULE_REQUEST_STUDENT: reminders.SESSION_COUNSELLOR_RESCHEDULE_REQUEST_STUDENT,
  FEEDBACK_STUDENT_PENDING_REMINDER_STUDENT: reminders.FEEDBACK_STUDENT_PENDING_REMINDER_STUDENT,
  FEEDBACK_STUDENT_PENDING_REMINDER_PARENT: reminders.FEEDBACK_STUDENT_PENDING_REMINDER_PARENT,
  FEEDBACK_PARENT_PENDING_REMINDER_STUDENT: reminders.FEEDBACK_PARENT_PENDING_REMINDER_STUDENT,
  FEEDBACK_PARENT_PENDING_REMINDER_PARENT: reminders.FEEDBACK_PARENT_PENDING_REMINDER_PARENT,
} as const;

export type EmailTemplateKey = keyof typeof emailTemplateRegistry;

export type EmailTemplateData<K extends EmailTemplateKey> = z.infer<(typeof emailTemplateRegistry)[K]["schema"]>;

export function renderEmailTemplate<K extends EmailTemplateKey>(
  templateKey: K,
  data: EmailTemplateData<K>
): RenderedEmail {
  const entry = emailTemplateRegistry[templateKey];
  const parsedData = entry.schema.parse(data);
  return entry.render(parsedData as never);
}
