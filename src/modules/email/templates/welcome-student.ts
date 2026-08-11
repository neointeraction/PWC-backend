import { z } from "zod";
import { heading, paragraph, renderLayout } from "./layout.js";

export const welcomeStudentDataSchema = z.object({
  studentName: z.string().trim().min(1),
});
export type WelcomeStudentData = z.infer<typeof welcomeStudentDataSchema>;

const ASSESSMENT_ROWS = [
  ["Career Interest", "The types of activities, subjects, careers and work environments you are naturally drawn towards.", "Intelligence, academic performance, character, or future success."],
  ["Personality Style", "Typical behavioural tendencies, interaction styles and ways of approaching work and learning situations.", "Good vs bad personality, values, morality, or personal worth."],
  ["Ability Potential", "Areas where you are likely to learn faster, solve problems more effectively, and perform well with training and practice.", "Effort, discipline, motivation, interest, or academic marks."],
  ["Thinking Capability", "How you prefer to process information, learn, evaluate options and make decisions.", "Intelligence level, right vs wrong thinking, or maturity."],
];

function assessmentTable(): string {
  const rows = ASSESSMENT_ROWS.map(
    ([area, measures, notMeasures]) =>
      `<tr><td style="padding:8px;border:1px solid #e4e4e7;">${area}</td><td style="padding:8px;border:1px solid #e4e4e7;">${measures}</td><td style="padding:8px;border:1px solid #e4e4e7;">${notMeasures}</td></tr>`
  ).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px;font-size:13px;">
    <tr style="background-color:#4c1d95;color:#ffffff;">
      <td style="padding:8px;border:1px solid #4c1d95;">Assessment Area</td>
      <td style="padding:8px;border:1px solid #4c1d95;">What It Measures</td>
      <td style="padding:8px;border:1px solid #4c1d95;">What It Does NOT Measure</td>
    </tr>
    ${rows}
  </table>`;
}

export function renderWelcomeStudentEmail(data: WelcomeStudentData) {
  const { studentName } = data;

  const body = [
    paragraph(`Hi ${studentName},`),
    paragraph(
      "Welcome to the kREATE Career Counselling programme! Your registration is confirmed. Before we begin, here's what you need to know."
    ),
    heading("What is the Career kREATE Report?"),
    paragraph(
      "Career kREATE is a report that helps you make intentional decisions about your future - helping you find a career you love, that you're good at, and that the world is willing to pay for. It offers insights into the streams and career paths where you're likely to find greater engagement, satisfaction, and opportunities for success, based on how you tend to respond to different learning, work, and career-related situations."
    ),
    paragraph(
      "The report is NOT judging your character or personality, labelling you as good or bad, predicting success or failure or restricting future possibilities."
    ),
    heading("How we look at Career"),
    assessmentTable(),
    paragraph(
      "Think of this report as a COMPASS rather than a map. It points you in a direction that is likely to suit you, but the journey and the destination will ultimately be shaped by your choices, effort, learning, and experiences."
    ),
    paragraph(
      "When you understand what motivates you and where your natural strengths lie, it becomes easier to choose the right subjects, educational pathways, and career opportunities. Learning becomes more meaningful when you understand how it connects to your future goals."
    ),
    paragraph(
      "The more your education, interests, abilities, and career choices are aligned, the greater the likelihood that you will enjoy your work, continue learning, and create a meaningful impact throughout your professional life."
    ),
    paragraph(
      "Your career journey is not about becoming what others expect you to be; it is about discovering where your strengths, interests, values, and opportunities come together to create a fulfilling future. We wish you the very best as you take the next steps in your unique career journey."
    ),
    heading("What Happens Next"),
    `<ol style="margin:0 0 16px;padding-left:20px;">
      <li>Log in and change your password to activate your account. Details in the next mail.</li>
      <li>Complete your Profile Form.</li>
      <li>Complete your own Pre-Counselling Form, just your honest views, likes and dislikes about careers. There is no right or wrong answer, so the more honest you are, the better the outcome. Your parent will separately receive a secure link by email to complete their own, independent Pre-Counselling Form.</li>
      <li>Once both forms are submitted, you'll take the Career Assessment.</li>
      <li>You'll then book Session 1 and Session 2 with a counsellor on the shared scheduling calendar.</li>
      <li>In Session 1, we'll finalise 6 career options and work out your 10+2 and graduation stream. You'll then take a short break to discuss with your parent (or whomever you'd like) and shortlist 2 careers.</li>
      <li>In Session 2, with the same counsellor, we'll build your complete career plan around these 2 careers.</li>
    </ol>`,
    paragraph(
      "Approach each questionnaire, assessment, and session discussion in that spirit. There is no right or wrong answer for anything."
    ),
    paragraph("All the Best!"),
  ].join("");

  const text = `Hi ${studentName},\n\nWelcome to the kREATE Career Counselling programme! Your registration is confirmed. Complete your Profile Form and Pre-Counselling Form, then take the Career Assessment and book your two counselling sessions.\n\nAll the Best!\nTeam kREATE | Design Destiny`;

  return {
    subject: "Welcome to the kREATE Career Counselling Programme",
    html: renderLayout(body),
    text,
  };
}
