import { env } from "../../config/env.js";

// Deep link into a specific parent/student form, mirroring the API's own
// `/forms/:formType/students/:studentId` path so the frontend route matches the API shape
// (same convention as the `/reset-password-confirm?token=...` link built in auth.service.ts).
// Parent form types are public (no login — see authenticateStudentForm), so this is the
// parent's *only* way into their child's specific form.
export function buildFormLink(formType: string, studentId: string): string {
  return `${env.APP_WEB_URL}/forms/${formType}/students/${studentId}`;
}
