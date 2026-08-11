import { z } from "zod";
import { button, paragraph, renderLayout } from "./layout.js";

export const preCounsellingParentDataSchema = z.object({
  parentName: z.string().trim().min(1),
  formLink: z.string().url(),
});
export type PreCounsellingParentData = z.infer<typeof preCounsellingParentDataSchema>;

export function renderPreCounsellingParentEmail(data: PreCounsellingParentData) {
  const { parentName, formLink } = data;

  const body = [
    paragraph(`Hi ${parentName},`),
    paragraph("This is not a report card, and it is not about evaluating your child."),
    paragraph(
      "As a parent, you observe your child in contexts that no teacher or counsellor ever sees - at home, in unguarded moments. That perspective is irreplaceable, and this form is how you share it."
    ),
    paragraph(
      "The counsellor will read both this form and your child's form together, looking for patterns, alignments, and gaps between how your child sees themselves and how you see them. That comparison is often where the most useful insights emerge."
    ),
    paragraph(
      "Your responses are completely confidential. Your child will not see this form. It will only be used to help the counsellor guide your child more meaningfully."
    ),
    `<ul style="margin:0 0 16px;padding-left:20px;">
      <li>Fill this independently, or together with your spouse. When both views are read together, the counsellor can offer guidance that is grounded in reality, not just self-perception.</li>
      <li>Answer based on what you genuinely observe, not what you hope for. Accurate observations including doubts, concerns, or gaps give the counsellor the clearest picture to work from.</li>
    </ul>`,
    paragraph(
      "Please complete the form using the link below. Kindly finish it in one sitting, the link expires once submitted and cannot be edited afterward."
    ),
    button("Complete Pre-Counselling Form", formLink),
    paragraph("All the Best!"),
  ].join("");

  const text = `Hi ${parentName},\n\nThis is not a report card, and it is not about evaluating your child. Please complete your independent Pre-Counselling Form using the link below. Finish it in one sitting, it cannot be edited once submitted.\n\nLink: ${formLink}\n\nAll the Best!\nTeam kREATE | Design Destiny`;

  return {
    subject: "Pre-counselling Form for kREATE Career Counselling Programme",
    html: renderLayout(body),
    text,
  };
}
