import { z } from "zod";
import { heading, paragraph, renderLayout } from "./layout.js";

export const welcomeParentDataSchema = z.object({
  parentName: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
});
export type WelcomeParentData = z.infer<typeof welcomeParentDataSchema>;

function assessmentTable(studentName: string): string {
  const rows: Array<[string, string, string]> = [
    ["Career Interest", `The types of activities, subjects, careers and work environments ${studentName} is naturally drawn towards.`, "Intelligence, academic performance, character, or future success."],
    ["Personality Style", "Typical behavioural tendencies, interaction styles and ways of approaching work and learning situations.", "Good vs bad personality, values, morality, or personal worth."],
    ["Ability Potential", `Areas where ${studentName} is likely to learn faster, solve problems more effectively, and perform well with training and practice.`, "Effort, discipline, motivation, interest, or academic marks."],
    ["Thinking Capability", `How ${studentName} prefers to process information, learn, evaluate options and make decisions.`, "Intelligence level, right vs wrong thinking, or maturity."],
  ];
  const body = rows
    .map(
      ([area, measures, notMeasures]) =>
        `<tr><td style="padding:8px;border:1px solid #e4e4e7;">${area}</td><td style="padding:8px;border:1px solid #e4e4e7;">${measures}</td><td style="padding:8px;border:1px solid #e4e4e7;">${notMeasures}</td></tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px;font-size:13px;">
    <tr style="background-color:#4c1d95;color:#ffffff;">
      <td style="padding:8px;border:1px solid #4c1d95;">Assessment Area</td>
      <td style="padding:8px;border:1px solid #4c1d95;">What It Measures</td>
      <td style="padding:8px;border:1px solid #4c1d95;">What It Does NOT Measure</td>
    </tr>
    ${body}
  </table>`;
}

export function renderWelcomeParentEmail(data: WelcomeParentData) {
  const { parentName, studentName } = data;

  const body = [
    paragraph(`Hi ${parentName},`),
    paragraph(
      `Welcome to the kREATE Career Counselling programme for ${studentName}! Before we begin, here's what you need to know.`
    ),
    paragraph(
      "This report is not an evaluation of your child's character, personality, or personal worth. It is a career-development report designed to understand how your child naturally approaches learning, work, decision-making, and career-related situations."
    ),
    paragraph(
      `The assessment looks at patterns in your child's interests, work preferences, thinking styles, abilities, and motivations, and seeks to answer questions such as what kinds of activities and subjects naturally interest ${studentName}, what type of work environment is likely to bring out ${studentName}'s best performance, how ${studentName} prefers to learn, think, and make decisions, and which skills and competencies may need further development for future success.`
    ),
    paragraph(
      "Based on these insights, the report provides recommendations regarding educational streams, career pathways, and developmental priorities."
    ),
    paragraph(
      "We believe most skills can be developed through learning, practice, and experience. Identifying a suitable direction early enables students to focus their efforts on developing the right competencies and making purposeful educational choices. The objective is not to predict success or failure, but to provide a career compass that helps students make more informed decisions about their future."
    ),
    heading("How we look at Career"),
    assessmentTable(studentName),
    heading("What Happens Next"),
    `<ol style="margin:0 0 16px;padding-left:20px;">
      <li>${studentName} will log in and change the default password. This is the step that activates the account.</li>
      <li>${studentName} will complete the Profile Form, which includes your details as the parent.</li>
      <li>${studentName} will complete their own Pre-Counselling Form. You'll separately receive a secure link by email to complete your own, independent Pre-Counselling Form, just your honest views, likes and dislikes about your child's career direction. This link expires and cannot be edited once submitted, so please complete it in one sitting.</li>
      <li>Once both forms are submitted, ${studentName} will take the Career Assessment.</li>
      <li>${studentName} will then book Session 1 and Session 2 with a counsellor.</li>
      <li>In Session 1, 6 career options will be finalised along with the 10+2 and graduation stream. ${studentName} will then take a short break to discuss with you and shortlist 2 careers.</li>
      <li>In Session 2, with the same counsellor, the complete career plan will be built around these 2 careers.</li>
    </ol>`,
    paragraph(
      `We encourage you to complete your Pre-Counselling and Feedback forms honestly and promptly. Your perspective plays an important role in helping ${studentName}'s report reflect a well-rounded, accurate picture.`
    ),
    paragraph(
      `Career conversations work best when the family is on the same page. We therefore encourage you to join ${studentName}'s counselling sessions.`
    ),
    paragraph("All the Best!"),
  ].join("");

  const text = `Hi ${parentName},\n\nWelcome to the kREATE Career Counselling programme for ${studentName}! Once ${studentName} activates their account and both of you complete the Pre-Counselling Forms, ${studentName} will take the Career Assessment and book two counselling sessions.\n\nAll the Best!\nTeam kREATE | Design Destiny`;

  return {
    subject: "Welcome to the kREATE Career Counselling Programme",
    html: renderLayout(body),
    text,
  };
}
