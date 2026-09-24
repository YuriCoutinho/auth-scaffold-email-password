import type { FastifyBaseLogger } from "fastify";
import { EmailProviderError, type EmailSender } from "../email/sender.js";
import { renderPasswordChangedEmail } from "./emails/password-changed.js";

interface SendPasswordChangedDeps {
  emailSender: EmailSender;
  log?: Pick<FastifyBaseLogger, "info" | "error"> | undefined;
}

interface SendPasswordChangedInput {
  to: string;
  userId: string;
}

// The password is already changed when this runs, so delivery never decides
// the response: the result is logged and nothing else. Provider bodies are not
// logged because they can echo the recipient address.
export async function sendPasswordChanged(
  deps: SendPasswordChangedDeps,
  input: SendPasswordChangedInput,
): Promise<boolean> {
  try {
    const { providerMessageId } = await deps.emailSender.send({
      to: input.to,
      ...renderPasswordChangedEmail(),
    });
    deps.log?.info(
      { userId: input.userId, providerMessageId },
      "password changed email sent",
    );
    return true;
  } catch (error) {
    deps.log?.error(
      error instanceof EmailProviderError
        ? { err: error, userId: input.userId, providerStatus: error.status }
        : { err: error, userId: input.userId },
      "password changed email delivery failed",
    );
    return false;
  }
}
