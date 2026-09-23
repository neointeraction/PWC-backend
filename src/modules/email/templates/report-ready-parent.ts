import { z } from "zod";
import { paragraph, renderLayout } from "./layout.js";

export const reportReadyParentDataSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
});
export type ReportReadyParentData = z.infer<typeof reportReadyParentDataSchema>;

// Parents have no portal login (only the student account can view the report in-app), so
// this can't point them at a "log in to view it" link. Copy is written for the report PDF
// being attached to this email — but attaching it isn't wired up yet (see
// acceptStudentReport in reports.service.ts and OutgoingEmail.attachments in
// email-provider.ts), so until then this promises an attachment that isn't actually there.
export function renderReportReadyParentEmail(data: ReportReadyParentData) {
  const { parentName, studentName } = data;

  const body = [
    paragraph(`Hi ${parentName},`),
    paragraph(`${studentName}'s Career kREATE Report is ready — please find it attached.`),
    paragraph(
      `We'd encourage you to go through the report together with ${studentName}, and to keep it as a reference point for the stream, course, and career conversations ahead.`
    ),
    paragraph("All the Best!"),
  ].join("");

  const text = `Hi ${parentName},\n\n${studentName}'s Career kREATE Report is ready — please find it attached.\n\nAll the Best!\nTeam kREATE | Design Destiny`;

  return {
    subject: `Career kREATE Report for ${studentName}`,
    html: renderLayout(body),
    text,
  };
}
