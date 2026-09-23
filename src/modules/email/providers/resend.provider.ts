import { Resend } from "resend";
import { env } from "../../../config/env.js";
import type { EmailProvider, OutgoingEmail, SendEmailResult } from "./email-provider.js";

export function createResendProvider(): EmailProvider {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY must be set to use the resend email provider");
  }

  const client = new Resend(env.RESEND_API_KEY);

  return {
    name: "resend",
    async send(email: OutgoingEmail): Promise<SendEmailResult> {
      // Resend has a single `attachments` field for both inline (cid-referenced) images
      // and real attachments — the only difference is whether contentId is set.
      const attachments = [
        ...(email.inlineImages ?? []).map((image) => ({
          filename: image.filename,
          content: image.base64Content,
          contentType: image.contentType,
          contentId: image.cid,
        })),
        ...(email.attachments ?? []).map((file) => ({
          filename: file.filename,
          content: file.base64Content,
          contentType: file.contentType,
        })),
      ];

      const result = await client.emails.send({
        from: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(attachments.length ? { attachments } : {}),
      });

      if (result.error) {
        throw new Error(`Resend send failed: ${result.error.message}`);
      }

      return { providerMessageId: result.data?.id ?? "unknown" };
    },
  };
}
