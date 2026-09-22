import type { FastifyBaseLogger } from "fastify";
import { SIGNUP_TTL_SECONDS } from "../../../lib/session.js";
import { EmailProviderError, type EmailSender } from "../email/sender.js";
import { renderSignupCodeEmail } from "./emails/signup-code.js";

interface SendSignupCodeDeps {
  emailSender: EmailSender;
  log?: Pick<FastifyBaseLogger, "info" | "error"> | undefined;
}

interface SendSignupCodeInput {
  to: string;
  code: string;
  pendingSignupId: number;
}

// Resolves to whether the email was delivered; the caller decides how to
// compensate. Provider bodies are not logged because they can echo the
// recipient address.
export async function sendSignupCode(
  deps: SendSignupCodeDeps,
  input: SendSignupCodeInput,
): Promise<boolean> {
  try {
    const { providerMessageId } = await deps.emailSender.send({
      to: input.to,
      ...renderSignupCodeEmail({
        code: input.code,
        ttlMinutes: SIGNUP_TTL_SECONDS / 60,
      }),
    });
    deps.log?.info(
      { pendingSignupId: input.pendingSignupId, providerMessageId },
      "signup code email sent",
    );
    return true;
  } catch (error) {
    deps.log?.error(
      error instanceof EmailProviderError
        ? { err: error, providerStatus: error.status }
        : { err: error },
      "signup code email delivery failed",
    );
    return false;
  }
}
