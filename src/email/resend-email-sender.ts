import { randomUUID } from "node:crypto";
import {
  type EmailMessage,
  EmailProviderError,
  type EmailSender,
} from "./email-sender.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_ATTEMPTS = 2;

const isRetryableStatus = (status: number) => status === 429 || status >= 500;

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly options: {
      apiKey: string;
      from: string;
      timeoutMs?: number;
    },
  ) {}

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    const idempotencyKey = randomUUID();
    const timeoutMs = this.options.timeoutMs ?? 10_000;
    let lastError = new EmailProviderError("resend request failed");

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            from: this.options.from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastError = new EmailProviderError("resend request failed", {
          cause: error,
        });
        continue;
      }

      if (response.ok) {
        const data = (await response.json()) as { id: string };
        return { providerMessageId: data.id };
      }

      const error = new EmailProviderError(
        `resend responded ${response.status}`,
        { status: response.status, body: await response.text() },
      );
      if (!isRetryableStatus(response.status)) {
        throw error;
      }
      lastError = error;
    }

    throw lastError;
  }
}
