import { z } from "zod";
import { TEXT_SIGN_OFF, SUPPORT_EMAIL, heading, paragraph, renderLayout, signOff } from "./layout.js";
import { EXPLORE_TOGETHER_HTML } from "./welcome-student.js";

export const welcomeParentDataSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
});
export type WelcomeParentData = z.infer<typeof welcomeParentDataSchema>;

export function renderWelcomeParentEmail(data: WelcomeParentData) {
  const { parentName, studentName } = data;

  const body = [
    paragraph(`Hi ${parentName},`),
    paragraph(
      `We are delighted to partner with you and ${studentName} on this journey toward making informed, confident choices about their career path.`
    ),
    heading("What is the Career kREATE Report?"),
    paragraph(
      `The Career kREATE report is a developmental guide, a <strong>compass rather than an exam</strong>. It is designed to map out how ${studentName} naturally learns, solves problems, and approaches career-related choices.`
    ),
    paragraph(
      "It does <strong>not</strong> evaluate your child's character, measure intelligence, or predict success or failure."
    ),
    heading("What we Explore Together"),
    EXPLORE_TOGETHER_HTML,
    heading("What Happens Next"),
    paragraph("To ensure a complete and well rounded perspective, <strong>your input is essential</strong>."),
    `<ol style="margin:0 0 16px;padding-left:20px;">
      <li><strong>Student Account Setup:</strong> ${studentName} logs in, updates their password, and completes their <strong>Profile Form</strong> and <strong>Pre-Counselling Form</strong>.</li>
      <li><strong>Your Pre-Counselling Form:</strong> You will receive a separate email containing your secure, independent Pre-Counselling link.</li>
      <li><strong>The Career Profile Assessment:</strong> Once both pre-counselling forms are submitted, ${studentName} will take the online Career Profile Assessment.</li>
      <li><strong>1-on-1 Mentoring Sessions (We strongly encourage you to attend):</strong>
        <ul style="margin:8px 0 0;padding-left:20px;list-style-type:circle;">
          <li><strong>Session 1:</strong> The counsellor and ${studentName} will identify suitable 10+2 streams and shortlist <strong>6 career paths</strong>. Afterward, you will review these together at home and narrow them down to <strong>2 top choices</strong>.</li>
          <li><strong>Session 2:</strong> Together with the same counsellor, we will build a clear, step-by-step career and educational roadmap around those <strong>2 selected careers</strong>.</li>
        </ul>
      </li>
    </ol>`,
    heading("Support &amp; Queries"),
    paragraph(
      `If you have any questions or need assistance at any point, please write to us at <strong>${SUPPORT_EMAIL}</strong>.`
    ),
    signOff(),
  ].join("");

  const text = `Hi ${parentName},

We are delighted to partner with you and ${studentName} on this journey toward making informed, confident choices about their career path.

The Career kREATE report is a developmental guide, a compass rather than an exam. It does not evaluate your child's character, measure intelligence, or predict success or failure.

What happens next (your input is essential):
1. ${studentName} logs in, updates their password, and completes their Profile Form and Pre-Counselling Form.
2. You will receive a separate email with your secure, independent Pre-Counselling link.
3. Once both forms are submitted, ${studentName} takes the online Career Profile Assessment.
4. 1-on-1 sessions (we strongly encourage you to attend): Session 1 shortlists 6 career paths, which you narrow to 2 at home; Session 2 builds a roadmap around those 2 careers.

Support & Queries: ${SUPPORT_EMAIL}

${TEXT_SIGN_OFF}`;

  return {
    subject: "Welcome to the kREATE Career Counselling Programme",
    html: renderLayout(body),
    text,
  };
}
