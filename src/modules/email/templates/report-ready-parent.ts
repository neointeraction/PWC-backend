import { z } from "zod";
import { TEXT_SIGN_OFF, paragraph, renderLayout, signOff } from "./layout.js";

export const reportReadyParentDataSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
});
export type ReportReadyParentData = z.infer<typeof reportReadyParentDataSchema>;

// Parents have no portal login (only the student account can view the report in-app), so
// this can't point them at a "log in to view it" link. The kREATE Compass report PDF is
// attached by the caller — see saveFormAnswers in forms.service.ts, which sends this once
// both feedback forms are in and skips the email entirely if the PDF render fails.
export function renderReportReadyParentEmail(data: ReportReadyParentData) {
  const { parentName, studentName } = data;

  const body = [
    paragraph(`Hi ${parentName},`),
    paragraph(`${studentName}'s Career kREATE Report is ready. Please find it attached.`),
    paragraph(
      `We'd encourage you to go through the report together with ${studentName}, and to keep it as a reference point for the stream, course, and career conversations ahead.`
    ),
    signOff(),
  ].join("");

  const text = `Hi ${parentName},\n\n${studentName}'s Career kREATE Report is ready. Please find it attached.\n\n${TEXT_SIGN_OFF}`;

  return {
    subject: `Career kREATE Report for ${studentName}`,
    html: renderLayout(body),
    text,
  };
}
