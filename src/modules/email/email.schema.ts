import { z } from "zod";
import { emailTemplateRegistry } from "./templates/index.js";

const templateKeys = Object.keys(emailTemplateRegistry) as [
  keyof typeof emailTemplateRegistry,
  ...Array<keyof typeof emailTemplateRegistry>,
];

export const sendTemplateEmailBodySchema = z.object({
  to: z.string().email(),
  templateKey: z.enum(templateKeys),
  data: z.record(z.string(), z.unknown()),
});
export type SendTemplateEmailBody = z.infer<typeof sendTemplateEmailBodySchema>;

export const listEmailTemplatesQuerySchema = z.object({});
