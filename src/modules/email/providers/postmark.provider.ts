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
      const result = await client.sendEmail({
        From: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`,
        To: email.to,
        Subject: email.subject,
        HtmlBody: email.html,
        TextBody: email.text,
        ...(env.POSTMARK_MESSAGE_STREAM ? { MessageStream: env.POSTMARK_MESSAGE_STREAM } : {}),
        ...(email.inlineImages?.length
          ? {
              Attachments: email.inlineImages.map((image) => ({
                Name: image.filename,
                Content: image.base64Content,
                ContentType: image.contentType,
                ContentID: `cid:${image.cid}`,
              })),
            }
          : {}),
      });

      return { providerMessageId: result.MessageID ?? "unknown" };
    },
  };
}
