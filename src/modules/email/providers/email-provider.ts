export interface InlineImage {
  cid: string;
  filename: string;
  contentType: string;
  base64Content: string;
}

// A real (non-inline) attachment — e.g. the report PDF handed to REPORT_READY_PARENT.
// Unlike InlineImage there's no cid: it's not referenced from the HTML body, just
// attached to the message.
export interface EmailAttachment {
  filename: string;
  contentType: string;
  base64Content: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  inlineImages?: InlineImage[];
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  providerMessageId: string;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<SendEmailResult>;
}
