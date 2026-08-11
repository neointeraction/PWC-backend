import { env } from "../../config/env.js";
import { BadRequestError } from "../../common/errors/AppError.js";
import { createConsoleProvider } from "./providers/console.provider.js";
import { createMailgunProvider } from "./providers/mailgun.provider.js";
import type { EmailProvider, SendEmailResult } from "./providers/email-provider.js";
import { emailTemplateRegistry, renderEmailTemplate, type EmailTemplateKey } from "./templates/index.js";

// EMAIL_PROVIDER selects which provider backs sendTemplateEmail — swap providers by
// changing env, not call sites. Add new providers by registering them here.
let cachedProvider: EmailProvider | undefined;

function getProvider(): EmailProvider {
  if (!cachedProvider) {
    cachedProvider = env.EMAIL_PROVIDER === "mailgun" ? createMailgunProvider() : createConsoleProvider();
  }
  return cachedProvider;
}

export function listEmailTemplateKeys(): EmailTemplateKey[] {
  return Object.keys(emailTemplateRegistry) as EmailTemplateKey[];
}

export async function sendTemplateEmail(
  to: string,
  templateKey: EmailTemplateKey,
  data: unknown
): Promise<SendEmailResult & { subject: string; provider: string }> {
  const entry = emailTemplateRegistry[templateKey];
  const parsed = entry.schema.safeParse(data);
  if (!parsed.success) {
    throw new BadRequestError(`Invalid data for template "${templateKey}"`, parsed.error.flatten());
  }

  const rendered = renderEmailTemplate(templateKey, parsed.data as never);
  const provider = getProvider();
  const result = await provider.send({ to, subject: rendered.subject, html: rendered.html, text: rendered.text });

  return { ...result, subject: rendered.subject, provider: provider.name };
}
