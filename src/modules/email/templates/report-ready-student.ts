import { z } from "zod";
import { button, paragraph, renderLayout } from "./layout.js";

export const reportReadyStudentDataSchema = z.object({
  studentName: z.string().trim().min(1),
  reportLink: z.string().url(),
});
export type ReportReadyStudentData = z.infer<typeof reportReadyStudentDataSchema>;

export function renderReportReadyStudentEmail(data: ReportReadyStudentData) {
  const { studentName, reportLink } = data;

  const body = [
    paragraph(`Hi ${studentName},`),
    paragraph(
      "Congratulations on completing the kREATE Career Counselling Programme! Your Career kREATE Report is ready. Please find it at the link below."
    ),
    button("View Your Report", reportLink),
    paragraph(
      "We'd recommend going through it with your parents and keeping it handy as you make decisions about your stream, courses, and next steps ahead."
    ),
    paragraph("All the best for the journey ahead!"),
    paragraph("All the Best!"),
  ].join("");

  const text = `Hi ${studentName},\n\nCongratulations on completing the kREATE Career Counselling Programme! Your Career kREATE Report is ready.\n\nLink: ${reportLink}\n\nAll the Best!\nTeam kREATE | Design Destiny`;

  return {
    subject: "Your Career kREATE Report is Ready",
    html: renderLayout(body),
    text,
  };
}
