import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

interface ReportPdfTokenPayload {
  studentId: string;
  purpose: "report-pdf";
}

// Short-lived, single-purpose token that lets the backend's own headless-Chromium report
// render (the future report-pdf.service.ts) read one student's report + counsellor chart
// with no login — parents have none, and this read happens server-to-server, not from a
// browser session. Minted in-process only: there is no endpoint that issues these, so
// nothing external can request one for an arbitrary student.
// `expiresIn` overrides env.REPORT_PDF_TOKEN_EXPIRES_IN — only tests need this, to mint
// an already-expired token without waiting.
export function signReportPdfToken(studentId: string, expiresIn?: string): string {
  const payload: ReportPdfTokenPayload = { studentId, purpose: "report-pdf" };
  return jwt.sign(payload, env.REPORT_PDF_TOKEN_SECRET, {
    expiresIn: expiresIn ?? env.REPORT_PDF_TOKEN_EXPIRES_IN,
  } as jwt.SignOptions);
}

// Returns the studentId if `token` is a valid, unexpired report-pdf token — null for
// anything else (wrong secret, expired, malformed, or a real access token).
export function verifyReportPdfToken(token: string): { studentId: string } | null {
  try {
    const payload = jwt.verify(token, env.REPORT_PDF_TOKEN_SECRET) as ReportPdfTokenPayload;
    if (payload.purpose !== "report-pdf" || typeof payload.studentId !== "string") {
      return null;
    }
    return { studentId: payload.studentId };
  } catch {
    return null;
  }
}
