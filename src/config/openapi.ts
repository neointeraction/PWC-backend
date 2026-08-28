import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  classIdParamsSchema,
  createInstituteClassSchema,
  createInstituteDivisionSchema,
  createInstituteSchema,
  instituteIdParamsSchema,
  updateInstituteSchema,
} from "../modules/institutes/institutes.schema.js";
import {
  createStudentSchema,
  listStudentsQuerySchema,
  studentIdParamsSchema,
  updateMyStudentSchema,
  updateStudentSchema,
  updateWorkflowStatusBodySchema,
} from "../modules/students/students.schema.js";
import {
  formStudentParamsSchema,
  formTypeParamsSchema,
  getFormTemplateQuerySchema,
  saveFormAnswersBodySchema,
} from "../modules/forms/forms.schema.js";
import {
  attemptIdParamsSchema,
  listAssessmentQuestionsQuerySchema,
  saveAssessmentAnswersBodySchema,
  startAttemptBodySchema,
} from "../modules/assessment/assessment.schema.js";
import {
  approveCareerRequestSchema,
  careerLibraryIdParamsSchema,
  careerRequestIdParamsSchema,
  createCareerEntrySchema,
  createCareerRequestSchema,
  listCareerLibraryQuerySchema,
  listCareerRequestsQuerySchema,
  listCoursesQuerySchema,
  listEntranceExamsQuerySchema,
  listInstitutionsQuerySchema,
  updateCareerEntrySchema,
} from "../modules/career-library/career-library.schema.js";
import {
  createClusterSchema,
  createDomainSchema,
  createIndustrySchema,
  listClustersQuerySchema,
  listDomainsQuerySchema,
  listIndustriesQuerySchema,
  taxonomyIdParamsSchema,
  updateClusterSchema,
  updateDomainSchema,
  updateIndustrySchema,
} from "../modules/career-taxonomy/career-taxonomy.schema.js";
import { sendTemplateEmailBodySchema } from "../modules/email/email.schema.js";
import {
  changePasswordBodySchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  resetPasswordBodySchema,
} from "../modules/auth/auth.schema.js";
import {
  assignProjectBodySchema,
  counsellorIdParamsSchema as counsellorCrudIdParamsSchema,
  counsellorProjectParamsSchema,
  createCounsellorSchema,
  listCounsellorsQuerySchema,
  updateCounsellorSchema,
} from "../modules/counsellors/counsellors.schema.js";
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParamsSchema,
  updateProjectSchema,
} from "../modules/projects/projects.schema.js";
import { previewScoreBodySchema } from "../modules/assessment/assessment.schema.js";
import { reportStudentParamsSchema } from "../modules/reports/reports.schema.js";
import {
  adminIdParamsSchema,
  createAdminSchema,
  listAdminsQuerySchema,
  updateAdminSchema,
} from "../modules/admins/admins.schema.js";
import {
  bookSessionsBodySchema,
  bookingOptionsQuerySchema,
  cancelSessionBodySchema,
  counsellorIdParamsSchema,
  counsellorMyStudentsQuerySchema,
  counsellorSessionsQuerySchema,
  createSessionBodySchema,
  importSlotsBodySchema,
  joinSessionBodySchema,
  listSessionsQuerySchema,
  listSlotsQuerySchema,
  rescheduleSessionBodySchema,
  sendDayReminderBodySchema,
  sessionIdParamsSchema,
  setMeetingLinkBodySchema,
  setNotesBodySchema,
  studentIdParamsSchema as sessionStudentIdParamsSchema,
} from "../modules/sessions/sessions.schema.js";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// Bearer JWT — applied as the document-level default below, so every path requires it in
// Swagger's "Authorize" flow except the ones that override with `security: []` (the public
// auth/health routes).
registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});
const PUBLIC = { security: [] as Array<Record<string, string[]>> };

const errorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const genericObjectSchema = z.object({}).passthrough();

const errorResponses = {
  400: { description: "Validation error", content: { "application/json": { schema: errorResponseSchema } } },
  404: { description: "Not found", content: { "application/json": { schema: errorResponseSchema } } },
  409: { description: "Conflict (duplicate unique field)", content: { "application/json": { schema: errorResponseSchema } } },
};

registry.registerPath({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Liveness check",
  ...PUBLIC,
  responses: {
    200: {
      description: "Service is up",
      content: { "application/json": { schema: z.object({ status: z.literal("ok"), timestamp: z.string() }) } },
    },
  },
});

// --- Auth ---

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/login",
  tags: ["Auth"],
  summary: "Log in. Sets an httpOnly refreshToken cookie and returns a short-lived access token + the user profile.",
  ...PUBLIC,
  request: { body: { content: { "application/json": { schema: loginBodySchema } } } },
  responses: {
    200: { description: "Access token + user", content: { "application/json": { schema: genericObjectSchema } } },
    401: { description: "Invalid credentials or inactive account", content: { "application/json": { schema: errorResponseSchema } } },
    400: errorResponses[400],
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/refresh",
  tags: ["Auth"],
  summary: "Exchange the refreshToken cookie for a new access token. Rotates the refresh token (single-use).",
  ...PUBLIC,
  responses: {
    200: { description: "New access token + user", content: { "application/json": { schema: genericObjectSchema } } },
    401: { description: "Missing, invalid, expired, or already-used refresh token", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/logout",
  tags: ["Auth"],
  summary: "Revoke the current refresh token and clear the cookie. Idempotent — 204 even with no/invalid cookie.",
  ...PUBLIC,
  responses: {
    204: { description: "Logged out" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/change-password",
  tags: ["Auth"],
  summary: "Change the current user's password (requires auth). Clears mustChangePassword and revokes all sessions.",
  request: { body: { content: { "application/json": { schema: changePasswordBodySchema } } } },
  responses: {
    204: { description: "Password changed" },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/forgot-password",
  tags: ["Auth"],
  summary: "Request a password reset link (public). Always 202 — never reveals whether the email exists.",
  ...PUBLIC,
  request: { body: { content: { "application/json": { schema: forgotPasswordBodySchema } } } },
  responses: {
    202: { description: "If an account exists, a reset link was emailed", content: { "application/json": { schema: genericObjectSchema } } },
    400: errorResponses[400],
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/reset-password",
  tags: ["Auth"],
  summary: "Consume a reset token and set a new password (public). Single-use token; revokes all sessions.",
  ...PUBLIC,
  request: { body: { content: { "application/json": { schema: resetPasswordBodySchema } } } },
  responses: {
    204: { description: "Password reset" },
    400: errorResponses[400],
  },
});

// --- Institutes ---

registry.registerPath({
  method: "post",
  path: "/api/v1/institutes",
  tags: ["Institutes"],
  summary: "Create an institute",
  request: { body: { content: { "application/json": { schema: createInstituteSchema } } } },
  responses: {
    201: { description: "Institute created", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/institutes",
  tags: ["Institutes"],
  summary: "List institutes",
  responses: {
    200: { description: "List of institutes", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/institutes/{id}",
  tags: ["Institutes"],
  summary: "Get an institute by id",
  request: { params: instituteIdParamsSchema },
  responses: {
    200: { description: "Institute", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/institutes/{id}",
  tags: ["Institutes"],
  summary: "Update an institute",
  request: {
    params: instituteIdParamsSchema,
    body: { content: { "application/json": { schema: updateInstituteSchema } } },
  },
  responses: {
    200: { description: "Updated institute", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/institutes/{id}",
  tags: ["Institutes"],
  summary: "Delete an institute",
  request: { params: instituteIdParamsSchema },
  responses: {
    204: { description: "Deleted" },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/institutes/{id}/classes",
  tags: ["Institutes"],
  summary: "Create a class under an institute",
  request: {
    params: instituteIdParamsSchema,
    body: { content: { "application/json": { schema: createInstituteClassSchema } } },
  },
  responses: {
    201: { description: "Class created", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/institutes/{id}/classes",
  tags: ["Institutes"],
  summary: "List classes under an institute",
  request: { params: instituteIdParamsSchema },
  responses: {
    200: { description: "List of classes", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/institutes/{id}/classes/{classId}/divisions",
  tags: ["Institutes"],
  summary: "Create a division under a class",
  request: {
    params: classIdParamsSchema,
    body: { content: { "application/json": { schema: createInstituteDivisionSchema } } },
  },
  responses: {
    201: { description: "Division created", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/institutes/{id}/classes/{classId}/divisions",
  tags: ["Institutes"],
  summary: "List divisions under a class",
  request: { params: classIdParamsSchema },
  responses: {
    200: { description: "List of divisions", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
    404: errorResponses[404],
  },
});

// --- Students ---

registry.registerPath({
  method: "post",
  path: "/api/v1/students",
  tags: ["Students"],
  summary: "Create a student (also creates a linked User with role STUDENT). studentCode is auto-generated (S0001, S0002, ...) unless supplied. Admin only.",
  request: { body: { content: { "application/json": { schema: createStudentSchema } } } },
  responses: {
    201: {
      description: "Student created. Response includes a one-time tempPassword for the linked user account.",
      content: { "application/json": { schema: genericObjectSchema } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/students",
  tags: ["Students"],
  summary:
    "List students. Each row includes a computed `stageInfo` { stage, stageLabel, stageEnteredAt, ageDays, flagged, flagReason } — the derived stage and ageing/🚩-flag (idle > 2 calendar days on an actionable stage, or a missed session). Filter with `stage` (derived-stage dropdown) and `flagged=true` (follow-up toggle). Ageing is computed live, never stored. Staff only.",
  request: { query: listStudentsQuerySchema },
  responses: {
    200: { description: "List of students, each with stageInfo", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/students/me",
  tags: ["Students"],
  summary: "Student self-service: the logged-in student's own record (id, studentCode, project, division, workflowStatus, contacts, active cohort). The entry point for every student-facing page. 404 for a non-student account.",
  responses: {
    200: { description: "The caller's own student record", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/students/me",
  tags: ["Students"],
  summary: "Student self-service edit: the logged-in student updates their own contact/parent details (whatsappNumber, parentMobile/Email, father/mother name/occupation/employer). Identity/enrolment fields stay admin-only. 404 for a non-student account.",
  request: {
    body: { content: { "application/json": { schema: updateMyStudentSchema } } },
  },
  responses: {
    200: { description: "The caller's updated student record", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/students/{id}",
  tags: ["Students"],
  summary: "Get a student by id",
  request: { params: studentIdParamsSchema },
  responses: {
    200: { description: "Student", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/students/{id}",
  tags: ["Students"],
  summary: "Update a student",
  request: {
    params: studentIdParamsSchema,
    body: { content: { "application/json": { schema: updateStudentSchema } } },
  },
  responses: {
    200: { description: "Updated student", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/students/{id}",
  tags: ["Students"],
  summary: "Delete a student (deletes the linked User too)",
  request: { params: studentIdParamsSchema },
  responses: {
    204: { description: "Deleted" },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/students/{id}/confirm-profile",
  tags: ["Students"],
  summary: "Student confirms their own profile data is correct (or staff on their behalf). Advances workflowStatus DRAFT -> PROFILE_COMPLETED. 409 if not currently DRAFT.",
  request: { params: studentIdParamsSchema },
  responses: {
    200: { description: "Updated student", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/students/{id}/workflow-status",
  tags: ["Students"],
  summary: "Admin override to set a student's workflowStatus directly (not forward-only) — covers stages not yet wired to an automatic trigger (Sessions, Counsellor Chart/Feedback, Reports)",
  request: {
    params: studentIdParamsSchema,
    body: { content: { "application/json": { schema: updateWorkflowStatusBodySchema } } },
  },
  responses: {
    200: { description: "Updated student", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

// --- Forms ---

registry.registerPath({
  method: "get",
  path: "/api/v1/forms/{formType}",
  tags: ["Forms"],
  summary: "Get a form template with its ordered questions",
  request: { params: formTypeParamsSchema, query: getFormTemplateQuerySchema },
  responses: {
    200: { description: "Form template with questions", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/forms/{formType}/students/{studentId}",
  tags: ["Forms"],
  summary: "Get a student's (or parent's) submission for a form, with answers",
  request: { params: formStudentParamsSchema, query: getFormTemplateQuerySchema },
  responses: {
    200: { description: "Form submission with answers", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/v1/forms/{formType}/students/{studentId}",
  tags: ["Forms"],
  summary: "Save/update in-progress answers (\"Save as Draft\"). Idempotent until submitted.",
  request: {
    params: formStudentParamsSchema,
    body: { content: { "application/json": { schema: saveFormAnswersBodySchema } } },
  },
  responses: {
    200: { description: "Updated draft submission", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/forms/{formType}/students/{studentId}/submit",
  tags: ["Forms"],
  summary: "Finalize a form submission. Validates required questions are answered, then locks it.",
  request: {
    params: formStudentParamsSchema,
    body: { content: { "application/json": { schema: saveFormAnswersBodySchema } } },
  },
  responses: {
    200: { description: "Submitted (locked) submission", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

// --- Assessment ---

registry.registerPath({
  method: "get",
  path: "/api/v1/assessment/questions",
  tags: ["Assessment"],
  summary: "List assessment questions for a cohort (correctOption is never included in the response)",
  request: { query: listAssessmentQuestionsQuerySchema },
  responses: {
    200: { description: "List of assessment questions", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/assessment/attempts",
  tags: ["Assessment"],
  summary: "Start a new attempt, or resume the student's existing in-progress one for this cohort",
  request: { body: { content: { "application/json": { schema: startAttemptBodySchema } } } },
  responses: {
    200: { description: "Attempt (new or resumed)", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/assessment/attempts/{attemptId}",
  tags: ["Assessment"],
  summary: "Get an attempt with its answers",
  request: { params: attemptIdParamsSchema },
  responses: {
    200: { description: "Attempt with answers", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "put",
  path: "/api/v1/assessment/attempts/{attemptId}/answers",
  tags: ["Assessment"],
  summary: "Save/update answers (\"Save Progress\"). Idempotent until submitted.",
  request: {
    params: attemptIdParamsSchema,
    body: { content: { "application/json": { schema: saveAssessmentAnswersBodySchema } } },
  },
  responses: {
    200: { description: "Updated attempt", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/assessment/attempts/{attemptId}/submit",
  tags: ["Assessment"],
  summary: "Finalize an attempt. Validates every question is answered, then locks it.",
  request: { params: attemptIdParamsSchema },
  responses: {
    200: { description: "Submitted (locked) attempt", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

// --- Career Library ---

registry.registerPath({
  method: "get",
  path: "/api/v1/career-library",
  tags: ["Career Library"],
  summary: "Search/list career library entries",
  request: { query: listCareerLibraryQuerySchema },
  responses: {
    200: {
      description: "Paginated list of career library entries",
      content: { "application/json": { schema: genericObjectSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/career-library/filters",
  tags: ["Career Library"],
  summary: "Distinct filter values (clusters, industries, domains, AI resilience grades) for building UI filter dropdowns",
  responses: {
    200: { description: "Filter option lists", content: { "application/json": { schema: genericObjectSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/career-library/{id}",
  tags: ["Career Library"],
  summary: "Get a career library entry, with related UG institutions/courses/entrance exams (by industry/cluster/exam-name mapping)",
  request: { params: careerLibraryIdParamsSchema },
  responses: {
    200: { description: "Career library entry with related data", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

// --- Sessions ---

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/slots/import",
  tags: ["Sessions"],
  summary: "One-time bulk import of the institute's counsellor-availability sheet for a project (single upload only, ever)",
  request: { body: { content: { "application/json": { schema: importSlotsBodySchema } } } },
  responses: {
    201: { description: "Slots imported", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/slots",
  tags: ["Sessions"],
  summary: "List counsellor slots (oversight)",
  request: { query: listSlotsQuerySchema },
  responses: {
    200: { description: "List of slots", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/students/{studentId}/booking-options",
  tags: ["Sessions"],
  summary: "Blind Session 1 slot options, or (with session1Date/session1StartTime) Session 2 options locked to Session 1's would-be counsellor",
  request: { params: sessionStudentIdParamsSchema, query: bookingOptionsQuerySchema },
  responses: {
    200: { description: "List of open (date, startTime, endTime) options", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/students/{studentId}/book",
  tags: ["Sessions"],
  summary: "Book Session 1 & 2 together (blind assignment, same counsellor locked, >=2 calendar day gap). Requires workflowStatus >= ASSESSMENT_COMPLETED.",
  request: { params: sessionStudentIdParamsSchema, body: { content: { "application/json": { schema: bookSessionsBodySchema } } } },
  responses: {
    201: { description: "Both sessions created", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/students/{studentId}",
  tags: ["Sessions"],
  summary: "List a student's sessions (dashboard cards)",
  request: { params: sessionStudentIdParamsSchema },
  responses: {
    200: { description: "List of sessions", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/counsellors/{counsellorId}",
  tags: ["Sessions"],
  summary: "List a counsellor's sessions (dashboard), optionally filtered by status",
  request: { params: counsellorIdParamsSchema, query: counsellorSessionsQuerySchema },
  responses: {
    200: { description: "List of sessions", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/counsellors/{counsellorId}/my-students",
  tags: ["Sessions"],
  summary: "\"My Students\" — a counsellor's roster across every project they're assigned to, with form/assessment/session status",
  request: { params: counsellorIdParamsSchema, query: counsellorMyStudentsQuerySchema },
  responses: {
    200: { description: "List of students with status summary", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions",
  tags: ["Sessions"],
  summary: "Admin manual session creation, for edge cases outside self-service booking (bypasses the slot inventory)",
  request: { body: { content: { "application/json": { schema: createSessionBodySchema } } } },
  responses: {
    201: { description: "Session created", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions",
  tags: ["Sessions"],
  summary: "Admin oversight: list/filter all sessions (institute/project/student/counsellor/status/date range)",
  request: { query: listSessionsQuerySchema },
  responses: {
    200: { description: "List of sessions", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/{id}",
  tags: ["Sessions"],
  summary: "Get a session by id",
  request: { params: sessionIdParamsSchema },
  responses: {
    200: { description: "Session", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/sessions/{id}/meeting-link",
  tags: ["Sessions"],
  summary: "Manually set/replace the meeting link (no Calendly/Google Meet integration yet — plain opaque string, also shared with the parent)",
  request: { params: sessionIdParamsSchema, body: { content: { "application/json": { schema: setMeetingLinkBodySchema } } } },
  responses: {
    200: { description: "Updated session", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/{id}/join",
  tags: ["Sessions"],
  summary: "Record a Join Now click and reveal the meeting link. Window: T-minus-10-minutes through the session's endTime.",
  request: { params: sessionIdParamsSchema, body: { content: { "application/json": { schema: joinSessionBodySchema } } } },
  responses: {
    200: { description: "Session + meetingLink", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/{id}/complete",
  tags: ["Sessions"],
  summary: "Mark a session COMPLETED (the \"Session Completed\" button). Advances workflowStatus to SESSION_1_COMPLETED / SESSION_2_COMPLETED.",
  request: { params: sessionIdParamsSchema },
  responses: {
    200: { description: "Updated session", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/sessions/{id}/notes",
  tags: ["Sessions"],
  summary: "Counsellor adds/updates session notes (independent of the scheduling flow)",
  request: { params: sessionIdParamsSchema, body: { content: { "application/json": { schema: setNotesBodySchema } } } },
  responses: {
    200: { description: "Updated session", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/{id}/reschedule",
  tags: ["Sessions"],
  summary: "Reschedule to a new date/time for the same (already-locked) counsellor. Student-initiated reschedules are blocked within 24h of the session.",
  request: { params: sessionIdParamsSchema, body: { content: { "application/json": { schema: rescheduleSessionBodySchema } } } },
  responses: {
    200: { description: "Updated session", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/{id}/cancel",
  tags: ["Sessions"],
  summary: "Cancel a session and release its slot back to OPEN",
  request: { params: sessionIdParamsSchema, body: { content: { "application/json": { schema: cancelSessionBodySchema } } } },
  responses: {
    200: { description: "Cancelled session", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/{id}/send-day-reminder",
  tags: ["Sessions"],
  summary: "Manually trigger the same-day reminder email to student + parent (no scheduler/cron exists yet — same gap as the Email module)",
  request: { params: sessionIdParamsSchema, body: { content: { "application/json": { schema: sendDayReminderBodySchema } } } },
  responses: {
    202: { description: "Reminder sent", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

// --- Email ---

registry.registerPath({
  method: "get",
  path: "/api/v1/email/templates",
  tags: ["Email"],
  summary: "List available email template keys",
  responses: {
    200: { description: "Template keys", content: { "application/json": { schema: genericObjectSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/email/send",
  tags: ["Email"],
  summary: "Render a template with merge data and send it via the configured email provider",
  request: { body: { content: { "application/json": { schema: sendTemplateEmailBodySchema } } } },
  responses: {
    202: { description: "Email accepted by the provider", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

// --- App Admins (SUPER_ADMIN only) ---

registry.registerPath({
  method: "post",
  path: "/api/v1/admins",
  tags: ["Admins"],
  summary: "Create an App Admin (User with role ADMIN or VIEW_ONLY_ADMIN) + temp password. SUPER_ADMIN only.",
  request: { body: { content: { "application/json": { schema: createAdminSchema } } } },
  responses: {
    201: { description: "Admin created (+ tempPassword)", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/admins",
  tags: ["Admins"],
  summary: "List App Admins (ADMIN + VIEW_ONLY_ADMIN), each with lastLoginAt (null until first login) for the \"Last Active\" column. Query: role?. SUPER_ADMIN only.",
  request: { query: listAdminsQuerySchema },
  responses: {
    200: { description: "List of app admins", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/admins/{id}",
  tags: ["Admins"],
  summary: "Get an App Admin by id (404 for non-admin users). SUPER_ADMIN only.",
  request: { params: adminIdParamsSchema },
  responses: {
    200: { description: "App admin", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/admins/{id}",
  tags: ["Admins"],
  summary: "Update an App Admin: firstName?/lastName?/role?/isActive?. `role` flips ADMIN <-> VIEW_ONLY_ADMIN (the view-only toggle). SUPER_ADMIN only.",
  request: { params: adminIdParamsSchema, body: { content: { "application/json": { schema: updateAdminSchema } } } },
  responses: {
    200: { description: "Updated app admin", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/admins/{id}/regenerate-password",
  tags: ["Admins"],
  summary: "Mint a fresh temporary password for an App Admin — returns { admin, tempPassword } once (plaintext never stored) and sets mustChangePassword. 404 for a non-admin id. SUPER_ADMIN only.",
  request: { params: adminIdParamsSchema },
  responses: {
    200: { description: "New temp password minted (+ tempPassword)", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/admins/{id}",
  tags: ["Admins"],
  summary: "Delete an App Admin. SUPER_ADMIN only.",
  request: { params: adminIdParamsSchema },
  responses: {
    204: { description: "Deleted" },
    404: errorResponses[404],
  },
});

// --- Counsellors ---

registry.registerPath({
  method: "post",
  path: "/api/v1/counsellors",
  tags: ["Counsellors"],
  summary: "Create a counsellor (creates a linked User with role COUNSELLOR + temp password). counsellorCode is auto-generated (C0001, C0002, ...) unless supplied. Optionally assign to projects. Admin only.",
  request: { body: { content: { "application/json": { schema: createCounsellorSchema } } } },
  responses: {
    201: { description: "Counsellor created (+ tempPassword)", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/counsellors",
  tags: ["Counsellors"],
  summary: "List counsellors (with user, institute, assigned projects). Staff.",
  request: { query: listCounsellorsQuerySchema },
  responses: {
    200: { description: "List of counsellors", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/counsellors/{id}",
  tags: ["Counsellors"],
  summary: "Get a counsellor by id. Staff.",
  request: { params: counsellorCrudIdParamsSchema },
  responses: {
    200: { description: "Counsellor", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/counsellors/{id}",
  tags: ["Counsellors"],
  summary: "Update a counsellor (firstName/lastName/mobile/isActive). Admin only.",
  request: { params: counsellorCrudIdParamsSchema, body: { content: { "application/json": { schema: updateCounsellorSchema } } } },
  responses: {
    200: { description: "Updated counsellor", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/counsellors/{id}",
  tags: ["Counsellors"],
  summary: "Delete a counsellor (409 if they have sessions — deactivate with isActive:false instead). Admin only.",
  request: { params: counsellorCrudIdParamsSchema },
  responses: {
    204: { description: "Deleted" },
    409: errorResponses[409],
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/counsellors/{id}/projects",
  tags: ["Counsellors"],
  summary: "Assign a counsellor to a project (ProjectCounsellor). Admin only.",
  request: { params: counsellorCrudIdParamsSchema, body: { content: { "application/json": { schema: assignProjectBodySchema } } } },
  responses: {
    200: { description: "Updated counsellor", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/counsellors/{id}/projects/{projectId}",
  tags: ["Counsellors"],
  summary: "Unassign a counsellor from a project. Admin only.",
  request: { params: counsellorProjectParamsSchema },
  responses: {
    200: { description: "Updated counsellor", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

// --- Projects ---

registry.registerPath({
  method: "post",
  path: "/api/v1/projects",
  tags: ["Projects"],
  summary: "Create a project (counselling cycle for an institute). code is auto-generated (P0001, P0002, ...). Admin only.",
  request: { body: { content: { "application/json": { schema: createProjectSchema } } } },
  responses: {
    201: { description: "Project created", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/projects",
  tags: ["Projects"],
  summary: "List projects (with institute + counts). Staff.",
  request: { query: listProjectsQuerySchema },
  responses: {
    200: { description: "List of projects", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/projects/{id}",
  tags: ["Projects"],
  summary: "Get a project by id. Staff.",
  request: { params: projectIdParamsSchema },
  responses: {
    200: { description: "Project", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/projects/{id}",
  tags: ["Projects"],
  summary: "Update a project (name/dates/status — status:CLOSED is the soft-close). Admin only.",
  request: { params: projectIdParamsSchema, body: { content: { "application/json": { schema: updateProjectSchema } } } },
  responses: {
    200: { description: "Updated project", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/projects/{id}",
  tags: ["Projects"],
  summary: "Soft-delete a project (status → DELETED, reversible — data preserved). Admin only.",
  request: { params: projectIdParamsSchema },
  responses: {
    200: { description: "The soft-deleted project (status DELETED)", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/projects/{id}/restore",
  tags: ["Projects"],
  summary: "Restore a soft-deleted project back to ACTIVE. Admin only.",
  request: { params: projectIdParamsSchema },
  responses: {
    200: { description: "The restored project (status ACTIVE)", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

// --- Career Library (writes + ratification) ---

registry.registerPath({
  method: "post",
  path: "/api/v1/career-library",
  tags: ["Career Library"],
  summary: "Create a career library entry (defaults to DRAFT; publish by setting ACTIVE). Admin only.",
  request: { body: { content: { "application/json": { schema: createCareerEntrySchema } } } },
  responses: {
    201: { description: "Entry created", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/career-library/{id}",
  tags: ["Career Library"],
  summary:
    "Update a career library entry (incl. status publish/unpublish). Admin only. Omitting a scalar leaves it unchanged; sending null clears it (nullable columns only — empty strings are rejected).",
  request: { params: careerLibraryIdParamsSchema, body: { content: { "application/json": { schema: updateCareerEntrySchema } } } },
  responses: {
    200: { description: "Updated entry", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/career-library/{id}",
  tags: ["Career Library"],
  summary: "Delete a career library entry. Admin only.",
  request: { params: careerLibraryIdParamsSchema },
  responses: {
    204: { description: "Deleted" },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/career-library/requests",
  tags: ["Career Library"],
  summary: "Submit a ratification request to add a career (counsellor resolved from token; admin passes requestedById). Staff.",
  request: { body: { content: { "application/json": { schema: createCareerRequestSchema } } } },
  responses: {
    201: { description: "Request created (PENDING)", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/career-library/requests",
  tags: ["Career Library"],
  summary: "List ratification requests (filter by status/requestedById). Staff.",
  request: { query: listCareerRequestsQuerySchema },
  responses: {
    200: { description: "List of requests", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/career-library/requests/{requestId}",
  tags: ["Career Library"],
  summary: "Get a ratification request by id. Staff.",
  request: { params: careerRequestIdParamsSchema },
  responses: {
    200: { description: "Request", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/career-library/requests/{requestId}/approve",
  tags: ["Career Library"],
  summary: "Approve a ratification request (optionally link the resulting entry). Admin only. 409 if already reviewed.",
  request: { params: careerRequestIdParamsSchema, body: { content: { "application/json": { schema: approveCareerRequestSchema } } } },
  responses: {
    200: { description: "Approved request", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/career-library/requests/{requestId}/reject",
  tags: ["Career Library"],
  summary: "Reject a ratification request. Admin only. 409 if already reviewed.",
  request: { params: careerRequestIdParamsSchema },
  responses: {
    200: { description: "Rejected request", content: { "application/json": { schema: genericObjectSchema } } },
    409: errorResponses[409],
    404: errorResponses[404],
  },
});

// --- Career Library (dropdown lookups for select-or-add) ---

registry.registerPath({
  method: "get",
  path: "/api/v1/career-library/entrance-exams",
  tags: ["Career Library"],
  summary:
    "Typeahead list of canonical entrance exams (for the select-or-add dropdown). Pass domainId to scope to exams already used by job roles in that domain. Any authenticated user.",
  request: { query: listEntranceExamsQuerySchema },
  responses: {
    200: { description: "Entrance exams", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/career-library/institutions",
  tags: ["Career Library"],
  summary:
    "Typeahead list of canonical institutions/colleges (for the select-or-add dropdown). Pass domainId to scope to institutions already used by job roles in that domain. Any authenticated user.",
  request: { query: listInstitutionsQuerySchema },
  responses: {
    200: { description: "Institutions", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/career-library/courses",
  tags: ["Career Library"],
  summary:
    "Typeahead list of canonical courses (for the select-or-add dropdown). Pass domainId to scope to courses already used by job roles in that domain. Any authenticated user.",
  request: { query: listCoursesQuerySchema },
  responses: {
    200: { description: "Courses", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

// --- Assessment (score preview) ---

registry.registerPath({
  method: "post",
  path: "/api/v1/assessment/score-preview",
  tags: ["Assessment"],
  summary: "Dev/QA: run the scoring engine over ad-hoc answers (no student/attempt/persistence). Staff.",
  request: { body: { content: { "application/json": { schema: previewScoreBodySchema } } } },
  responses: {
    200: { description: "Computed report", content: { "application/json": { schema: genericObjectSchema } } },
    ...errorResponses,
  },
});

// --- Cohorts ---

registry.registerPath({
  method: "get",
  path: "/api/v1/cohorts",
  tags: ["Cohorts"],
  summary: "List active cohorts (read-only lookup for dropdowns, e.g. project creation). Staff.",
  responses: {
    200: { description: "Active cohorts, in display order", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

// --- Languages ---

registry.registerPath({
  method: "get",
  path: "/api/v1/languages",
  tags: ["Languages"],
  summary: "List active languages (read-only lookup for the project-creation dropdown). Staff.",
  responses: {
    200: { description: "Active languages, in display order (English is the default)", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  },
});

// --- Reports ---

registry.registerPath({
  method: "get",
  path: "/api/v1/reports/students/{studentId}/assessment",
  tags: ["Reports"],
  summary: "Full student assessment report as structured JSON (student sees own; staff any). 404 until the assessment is completed.",
  request: { params: reportStudentParamsSchema },
  responses: {
    200: { description: "Assembled report", content: { "application/json": { schema: genericObjectSchema } } },
    404: errorResponses[404],
  },
});

// --- Career Taxonomy (Cluster → Industry → Domain) ---

const taxTag = ["Career Taxonomy"];
const taxListResponses = {
  200: { description: "Taxonomy nodes", content: { "application/json": { schema: z.array(genericObjectSchema) } } },
  400: errorResponses[400],
};

registry.registerPath({
  method: "get",
  path: "/api/v1/career-taxonomy/tree",
  tags: taxTag,
  summary: "Full live hierarchy (clusters → industries → domains) for the cascading picker. Any authenticated user.",
  responses: { 200: { description: "Taxonomy tree", content: { "application/json": { schema: z.array(genericObjectSchema) } } } },
});

// Clusters
registry.registerPath({
  method: "get",
  path: "/api/v1/career-taxonomy/clusters",
  tags: taxTag,
  summary: "List clusters (live only; ?includeDeleted=true for soft-deleted). Any authenticated user.",
  request: { query: listClustersQuerySchema },
  responses: taxListResponses,
});
registry.registerPath({
  method: "post",
  path: "/api/v1/career-taxonomy/clusters",
  tags: taxTag,
  summary: "Create a cluster (admin). 409 if a live cluster already has the name.",
  request: { body: { content: { "application/json": { schema: createClusterSchema } } } },
  responses: { 201: { description: "Created cluster", content: { "application/json": { schema: genericObjectSchema } } }, ...errorResponses },
});
registry.registerPath({
  method: "patch",
  path: "/api/v1/career-taxonomy/clusters/{id}",
  tags: taxTag,
  summary: "Rename a cluster (admin). 409 on name clash.",
  request: { params: taxonomyIdParamsSchema, body: { content: { "application/json": { schema: updateClusterSchema } } } },
  responses: { 200: { description: "Updated cluster", content: { "application/json": { schema: genericObjectSchema } } }, ...errorResponses },
});
registry.registerPath({
  method: "delete",
  path: "/api/v1/career-taxonomy/clusters/{id}",
  tags: taxTag,
  summary: "Soft-delete a cluster (admin). Hidden from pickers; existing job roles still resolve.",
  request: { params: taxonomyIdParamsSchema },
  responses: { 200: { description: "Soft-deleted cluster", content: { "application/json": { schema: genericObjectSchema } } }, 404: errorResponses[404] },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/career-taxonomy/clusters/{id}/restore",
  tags: taxTag,
  summary: "Restore a soft-deleted cluster (admin). 409 if a live cluster now holds the name.",
  request: { params: taxonomyIdParamsSchema },
  responses: { 200: { description: "Restored cluster", content: { "application/json": { schema: genericObjectSchema } } }, ...errorResponses },
});

// Industries
registry.registerPath({
  method: "get",
  path: "/api/v1/career-taxonomy/industries",
  tags: taxTag,
  summary: "List industries (?clusterId to scope; ?includeDeleted=true). Any authenticated user.",
  request: { query: listIndustriesQuerySchema },
  responses: taxListResponses,
});
registry.registerPath({
  method: "post",
  path: "/api/v1/career-taxonomy/industries",
  tags: taxTag,
  summary: "Create an industry under a cluster (admin). 409 on duplicate name within the cluster.",
  request: { body: { content: { "application/json": { schema: createIndustrySchema } } } },
  responses: { 201: { description: "Created industry", content: { "application/json": { schema: genericObjectSchema } } }, ...errorResponses },
});
registry.registerPath({
  method: "patch",
  path: "/api/v1/career-taxonomy/industries/{id}",
  tags: taxTag,
  summary: "Rename or re-parent an industry (admin). 409 on name clash within the target cluster.",
  request: { params: taxonomyIdParamsSchema, body: { content: { "application/json": { schema: updateIndustrySchema } } } },
  responses: { 200: { description: "Updated industry", content: { "application/json": { schema: genericObjectSchema } } }, ...errorResponses },
});
registry.registerPath({
  method: "delete",
  path: "/api/v1/career-taxonomy/industries/{id}",
  tags: taxTag,
  summary: "Soft-delete an industry (admin).",
  request: { params: taxonomyIdParamsSchema },
  responses: { 200: { description: "Soft-deleted industry", content: { "application/json": { schema: genericObjectSchema } } }, 404: errorResponses[404] },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/career-taxonomy/industries/{id}/restore",
  tags: taxTag,
  summary: "Restore a soft-deleted industry (admin). 409 on name clash.",
  request: { params: taxonomyIdParamsSchema },
  responses: { 200: { description: "Restored industry", content: { "application/json": { schema: genericObjectSchema } } }, ...errorResponses },
});

// Domains
registry.registerPath({
  method: "get",
  path: "/api/v1/career-taxonomy/domains",
  tags: taxTag,
  summary: "List domains (?industryId to scope; ?includeDeleted=true). Any authenticated user.",
  request: { query: listDomainsQuerySchema },
  responses: taxListResponses,
});
registry.registerPath({
  method: "post",
  path: "/api/v1/career-taxonomy/domains",
  tags: taxTag,
  summary: "Create a domain under an industry (admin). 409 on duplicate name within the industry.",
  request: { body: { content: { "application/json": { schema: createDomainSchema } } } },
  responses: { 201: { description: "Created domain", content: { "application/json": { schema: genericObjectSchema } } }, ...errorResponses },
});
registry.registerPath({
  method: "patch",
  path: "/api/v1/career-taxonomy/domains/{id}",
  tags: taxTag,
  summary: "Rename or re-parent a domain (admin). 409 on name clash within the target industry.",
  request: { params: taxonomyIdParamsSchema, body: { content: { "application/json": { schema: updateDomainSchema } } } },
  responses: { 200: { description: "Updated domain", content: { "application/json": { schema: genericObjectSchema } } }, ...errorResponses },
});
registry.registerPath({
  method: "delete",
  path: "/api/v1/career-taxonomy/domains/{id}",
  tags: taxTag,
  summary: "Soft-delete a domain (admin).",
  request: { params: taxonomyIdParamsSchema },
  responses: { 200: { description: "Soft-deleted domain", content: { "application/json": { schema: genericObjectSchema } } }, 404: errorResponses[404] },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/career-taxonomy/domains/{id}/restore",
  tags: taxTag,
  summary: "Restore a soft-deleted domain (admin). 409 on name clash.",
  request: { params: taxonomyIdParamsSchema },
  responses: { 200: { description: "Restored domain", content: { "application/json": { schema: genericObjectSchema } } }, ...errorResponses },
});

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "Counselling Platform API",
      version: "0.1.0",
      description:
        "API for the counselling platform. Most routes require a Bearer access token " +
        "(Authorize button); the public exceptions are auth/login, refresh, logout, " +
        "forgot/reset-password, health, and the parent forms.",
    },
    servers: [{ url: "/" }],
    // Default: every path requires the bearer token, except those that set `security: []`.
    security: [{ bearerAuth: [] }],
  });
}
