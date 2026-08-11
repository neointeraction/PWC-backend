import FormData from "form-data";
import Mailgun from "mailgun.js";
import { env } from "../../../config/env.js";
import type { EmailProvider, OutgoingEmail, SendEmailResult } from "./email-provider.js";

const MAILGUN_BASE_URL = env.MAILGUN_REGION === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";

export function createMailgunProvider(): EmailProvider {
  if (!env.MAILGUN_API_KEY || !env.MAILGUN_DOMAIN) {
    throw new Error("MAILGUN_API_KEY and MAILGUN_DOMAIN must be set to use the mailgun email provider");
  }

  const mailgun = new Mailgun(FormData);
  const client = mailgun.client({
    username: "api",
    key: env.MAILGUN_API_KEY,
    url: MAILGUN_BASE_URL,
  });
  const domain = env.MAILGUN_DOMAIN;

  return {
    name: "mailgun",
    async send(email: OutgoingEmail): Promise<SendEmailResult> {
      const result = await client.messages.create(domain, {
        from: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      return { providerMessageId: result.id ?? "unknown" };
    },
  };
}
