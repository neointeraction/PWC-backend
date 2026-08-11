import { randomUUID } from "node:crypto";
import type { EmailProvider, OutgoingEmail, SendEmailResult } from "./email-provider.js";

// Logs the email instead of sending it. Default provider so local dev / early MVP
// trials don't need real email credentials configured.
export function createConsoleProvider(): EmailProvider {
  return {
    name: "console",
    async send(email: OutgoingEmail): Promise<SendEmailResult> {
      const providerMessageId = randomUUID();
      console.log(
        `[email:console] to=${email.to} subject="${email.subject}" messageId=${providerMessageId}\n${email.text}`
      );
      return { providerMessageId };
    },
  };
}
