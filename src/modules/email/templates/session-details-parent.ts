import { z } from "zod";
import { paragraph, renderLayout } from "./layout.js";

export const sessionDetailsParentDataSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
  session1Date: z.string().trim().min(1),
  session1Time: z.string().trim().min(1),
  session1Link: z.string().url(),
  session2Date: z.string().trim().min(1),
  session2Time: z.string().trim().min(1),
  session2Link: z.string().url(),
});
export type SessionDetailsParentData = z.infer<typeof sessionDetailsParentDataSchema>;

export function renderSessionDetailsParentEmail(data: SessionDetailsParentData) {
  const {
    parentName,
    studentName,
    session1Date,
    session1Time,
    session1Link,
    session2Date,
    session2Time,
    session2Link,
  } = data;

  const body = [
    paragraph(`Hi ${parentName},`),
    paragraph(
      `${studentName}'s counselling sessions have been scheduled. The sessions are conducted over video call, and the same counsellor is assigned to both sessions.`
    ),
    paragraph(
      `<strong>Session 1:</strong> ${session1Date}, ${session1Time}<br/>Link: <a href="${session1Link}">${session1Link}</a>`
    ),
    paragraph(
      `<strong>Session 2:</strong> ${session2Date}, ${session2Time}<br/>Link: <a href="${session2Link}">${session2Link}</a>`
    ),
    paragraph(
      `We encourage you to join these sessions alongside ${studentName}. It gives you the same perspective on the careers being discussed and helps you guide ${studentName} with clarity after the sessions end.`
    ),
    paragraph("Please join a few minutes before the scheduled time."),
    paragraph("All the Best!"),
  ].join("");

  const text = `Hi ${parentName},\n\n${studentName}'s counselling sessions have been scheduled.\n\nSession 1: ${session1Date}, ${session1Time}\nLink: ${session1Link}\n\nSession 2: ${session2Date}, ${session2Time}\nLink: ${session2Link}\n\nAll the Best!\nTeam kREATE | Design Destiny`;

  return {
    subject: "Session Details for kREATE Career Counselling Programme",
    html: renderLayout(body),
    text,
  };
}
