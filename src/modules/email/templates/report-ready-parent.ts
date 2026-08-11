import { z } from "zod";
import { button, paragraph, renderLayout } from "./layout.js";

export const reportReadyParentDataSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
  reportLink: z.string().url(),
});
export type ReportReadyParentData = z.infer<typeof reportReadyParentDataSchema>;

export function renderReportReadyParentEmail(data: ReportReadyParentData) {
  const { parentName, studentName, reportLink } = data;

  const body = [
    paragraph(`Hi ${parentName},`),
    paragraph(`${studentName}'s Career kREATE Report is ready. Please find it at the link below.`),
    button("View Report", reportLink),
    paragraph(
      `We'd encourage you to go through the report together with ${studentName}, and to keep it as a reference point for the stream, course, and career conversations ahead.`
    ),
    paragraph("All the Best!"),
  ].join("");

  const text = `Hi ${parentName},\n\n${studentName}'s Career kREATE Report is ready.\n\nLink: ${reportLink}\n\nAll the Best!\nTeam kREATE | Design Destiny`;

  return {
    subject: `Career kREATE Report for ${studentName}`,
    html: renderLayout(body),
    text,
  };
}
