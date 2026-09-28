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
  // Declared, not emitted as a class field: it is installed below as a
  // non-enumerable property. The error serializer of pino copies own
  // enumerable properties, and a provider body can echo the recipient address.
  declare readonly body?: string;

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
      Object.defineProperty(this, "body", {
        value: options.body,
        enumerable: false,
        configurable: true,
      });
    }
  }
}
