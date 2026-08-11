export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  providerMessageId: string;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<SendEmailResult>;
}
