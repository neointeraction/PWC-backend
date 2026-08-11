import { z } from "zod";
import { button, paragraph, renderLayout } from "./layout.js";

export const feedbackRequestParentDataSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
  feedbackFormLink: z.string().url(),
});
export type FeedbackRequestParentData = z.infer<typeof feedbackRequestParentDataSchema>;

export function renderFeedbackRequestParentEmail(data: FeedbackRequestParentData) {
  const { parentName, studentName, feedbackFormLink } = data;

  const body = [
    paragraph(`Hi ${parentName},`),
    paragraph(
      `${studentName}'s counselling sessions are now complete. Before the final Career kREATE Report can be released, we need feedback from both ${studentName} and you.`
    ),
    paragraph("Please take a few minutes to share your feedback using the link below:"),
    button("Share Feedback", feedbackFormLink),
    paragraph(
      "The report becomes available for download as soon as both feedback forms are submitted, so we'd appreciate you completing yours at the earliest."
    ),
    paragraph("All the Best!"),
  ].join("");

  const text = `Hi ${parentName},\n\n${studentName}'s counselling sessions are now complete. Please share your feedback using the link below so the final report can be released.\n\nLink: ${feedbackFormLink}\n\nAll the Best!\nTeam kREATE | Design Destiny`;

  return {
    subject: "Feedback Report for kREATE Career Counselling Programme",
    html: renderLayout(body),
    text,
  };
}
