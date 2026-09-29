import { z } from "zod";
import { TEXT_NEED_HELP, TEXT_SIGN_OFF, heading, needHelp, paragraph, renderLayout, signOff } from "./layout.js";

export const welcomeStudentDataSchema = z.object({
  studentName: z.string().trim().min(1),
});
export type WelcomeStudentData = z.infer<typeof welcomeStudentDataSchema>;

// Shared with welcome-parent.ts — the PDF uses identical copy for both.
export const EXPLORE_TOGETHER_HTML = `<ul style="margin:0 0 16px;padding-left:20px;">
      <li><strong>Career Interests:</strong> The subjects, activities, and environments you naturally enjoy.</li>
      <li><strong>Personality Style:</strong> How you prefer to interact, collaborate and tackle projects.</li>
      <li><strong>Thinking Style:</strong> How you process information, evaluate choices and solve problems.</li>
      <li><strong>Skill Sets:</strong> Strengths you already have, along with areas you can develop over time.</li>
    </ul>`;

const subHeading = (text: string) => `<p style="margin:0 0 8px;text-decoration:underline;">${text}</p>`;

export function renderWelcomeStudentEmail(data: WelcomeStudentData) {
  const { studentName } = data;

  const body = [
    paragraph(`Hi ${studentName},`),
    paragraph("We are excited to help you explore your interests and discover the possibilities ahead."),
    heading("What is the Career kREATE Report?"),
    paragraph(
      "The Career kREATE report is designed to help you make confident decisions about your future, pointing you toward careers you will enjoy, excel at, and find meaningful opportunities in."
    ),
    paragraph(
      "It highlights streams and career paths aligned with your natural strengths, learning style and interests. Most importantly, this is <strong>not an exam</strong>:"
    ),
    `<ul style="margin:0 0 16px;padding-left:20px;">
      <li>It does <strong>not</strong> label you as "good" or "bad."</li>
      <li>It does <strong>not</strong> predict success or failure.</li>
      <li>It does <strong>not</strong> limit what you can choose to pursue.</li>
    </ul>`,
    paragraph(
      "Think of this report as a <strong>compass rather than a map</strong>. It points you in a promising direction, but the path you take is entirely yours to decide."
    ),
    heading("What we Explore Together"),
    EXPLORE_TOGETHER_HTML,
    heading("What Happens Next"),
    subHeading("Phase 1: Getting Set Up (On Your Portal)"),
    `<ol style="margin:0 0 16px;padding-left:20px;">
      <li><strong>Log in</strong> and update your password.</li>
      <li>Complete your <strong>Profile Form</strong> and your <strong>Pre-Counselling Form</strong>.</li>
      <li><strong>Parent Form</strong>: A separate pre-counselling link will be emailed to your parent. If they haven't received it, you can copy the link directly from your dashboard and share it with them.</li>
      <li><strong>Career Profile Assessment</strong>: Once both forms are submitted, complete your Career Profile Assessment.</li>
    </ol>`,
    subHeading("Phase 2: Your 1-on-1 Sessions"),
    `<ol start="5" style="margin:0 0 16px;padding-left:20px;">
      <li><strong>Book Your Sessions</strong>: Use the calendar on your dashboard to book Session 1 and Session 2.</li>
      <li><strong>Session 1</strong>: Together with your counsellor, you'll explore top fields, identify your 10+2 stream and narrow down to 6 career options. Afterward, you'll have time to discuss these with your parents and select your top 2 careers.</li>
      <li><strong>Session 2</strong>: With the same counsellor, you will build a clear, actionable roadmap around your chosen 2 careers.</li>
    </ol>`,
    needHelp(),
    signOff(),
  ].join("");

  const text = `Hi ${studentName},

We are excited to help you explore your interests and discover the possibilities ahead.

The Career kREATE report points you toward streams and careers aligned with your strengths, learning style and interests. It is not an exam: it doesn't label you, predict success or failure, or limit what you can choose.

What happens next:
1. Log in and update your password.
2. Complete your Profile Form and your Pre-Counselling Form.
3. Your parent will be emailed a separate pre-counselling link (you can also copy it from your dashboard).
4. Once both forms are submitted, complete your Career Profile Assessment.
5. Book Session 1 and Session 2 from your dashboard calendar.
6. Session 1: explore top fields, identify your 10+2 stream and narrow down to 6 careers; then pick your top 2 with your parents.
7. Session 2: build a clear roadmap around your chosen 2 careers with the same counsellor.

${TEXT_NEED_HELP}

${TEXT_SIGN_OFF}`;

  return {
    subject: "Welcome to the kREATE Career Counselling Programme",
    html: renderLayout(body),
    text,
  };
}
