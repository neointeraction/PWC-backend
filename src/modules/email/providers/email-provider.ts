export interface InlineImage {
  cid: string;
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
}

export interface SendEmailResult {
  providerMessageId: string;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<SendEmailResult>;
}
