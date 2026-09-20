import nodemailer, { type Transporter } from "nodemailer";
import type { EmailMessage, EmailSender } from "../email-sender.js";

export class MailpitEmailSender implements EmailSender {
  private readonly transporter: Transporter;

  constructor(private readonly options: { from: string }) {
    this.transporter = nodemailer.createTransport({
      host: "localhost",
      port: 1025,
      secure: false,
    });
  }

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    const info = await this.transporter.sendMail({
      from: this.options.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return { providerMessageId: info.messageId };
  }
}
