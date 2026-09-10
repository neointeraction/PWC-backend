import { z } from "zod";
import { paragraph, renderLayout } from "./layout.js";

export const reportReadyParentDataSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
});
export type ReportReadyParentData = z.infer<typeof reportReadyParentDataSchema>;

export function renderReportReadyParentEmail(data: ReportReadyParentData) {
  const { parentName, studentName } = data;

  const body = [
    paragraph(`Hi ${parentName},`),
    paragraph(`${studentName}'s Career kREATE Report is ready. ${studentName} can view it after logging in.`),
    paragraph(
      `We'd encourage you to go through the report together with ${studentName}, and to keep it as a reference point for the stream, course, and career conversations ahead.`
    ),
    paragraph("All the Best!"),
  ].join("");

  const text = `Hi ${parentName},\n\n${studentName}'s Career kREATE Report is ready. ${studentName} can view it after logging in.\n\nAll the Best!\nTeam kREATE | Design Destiny`;

  return {
    subject: `Career kREATE Report for ${studentName}`,
    html: renderLayout(body),
    text,
  };
}
