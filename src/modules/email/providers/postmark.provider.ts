import { ServerClient } from "postmark";
import { env } from "../../../config/env.js";
import type { EmailProvider, OutgoingEmail, SendEmailResult } from "./email-provider.js";

export function createPostmarkProvider(): EmailProvider {
  if (!env.POSTMARK_API_KEY) {
    throw new Error("POSTMARK_API_KEY must be set to use the postmark email provider");
  }

  const client = new ServerClient(env.POSTMARK_API_KEY);

  return {
    name: "postmark",
    async send(email: OutgoingEmail): Promise<SendEmailResult> {
      // Postmark has a single Attachments field for both inline (cid-referenced) images
      // and real attachments — the only difference is whether ContentID is set.
      const attachments = [
        ...(email.inlineImages ?? []).map((image) => ({
          Name: image.filename,
          Content: image.base64Content,
          ContentType: image.contentType,
          ContentID: `cid:${image.cid}`,
        })),
        ...(email.attachments ?? []).map((file) => ({
          Name: file.filename,
          Content: file.base64Content,
          ContentType: file.contentType,
          ContentID: null,
        })),
      ];

      const result = await client.sendEmail({
        From: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`,
        To: email.to,
        Subject: email.subject,
        HtmlBody: email.html,
        TextBody: email.text,
        ...(env.POSTMARK_MESSAGE_STREAM ? { MessageStream: env.POSTMARK_MESSAGE_STREAM } : {}),
        ...(attachments.length ? { Attachments: attachments } : {}),
      });

      return { providerMessageId: result.MessageID ?? "unknown" };
    },
  };
}
