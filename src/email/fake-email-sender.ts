import type { EmailMessage, EmailSender } from "./email-sender.js";

export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    this.sent.push(message);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}
