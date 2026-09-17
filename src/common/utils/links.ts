import { env } from "../../config/env.js";

// The frontend does NOT mirror the API's `/forms/:formType/students/:studentId` shape —
// it registers a distinct path per form type (see PWC-frontend src/constants/index.ts /
// src/app/routes.tsx). Parent routes are public and take the studentId as a param (parents
// have no login, so this is their *only* way into their child's specific form — see
// authenticateStudentForm); student routes are behind ProtectedRoute and read the current
// student off the auth token, so they take no id.
const FORM_PATHS: Record<string, string> = {
  PRE_COUNSELLING_STUDENT: "/pre-counseling-form",
  PRE_COUNSELLING_PARENT: "/parent-pre-counselling-form",
  FEEDBACK_STUDENT: "/student-feedback-form",
  FEEDBACK_PARENT: "/parent-feedback-form",
};
const PARENT_FORM_TYPES = new Set(["PRE_COUNSELLING_PARENT", "FEEDBACK_PARENT"]);

export function buildFormLink(formType: string, studentId: string): string {
  const path = FORM_PATHS[formType];
  if (!path) {
    throw new Error(`buildFormLink: unknown formType "${formType}"`);
  }
  return PARENT_FORM_TYPES.has(formType)
    ? `${env.APP_WEB_URL}${path}/${studentId}`
    : `${env.APP_WEB_URL}${path}`;
}
