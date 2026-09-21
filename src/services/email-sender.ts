export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}

export class EmailProviderError extends Error {
  readonly status?: number;
  readonly body?: string;

  constructor(
    message: string,
    options: { status?: number; body?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "EmailProviderError";
    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.body !== undefined) {
      this.body = options.body;
    }
  }
}
