import type { FastifyBaseLogger } from "fastify";
import { PASSWORD_RESET_TTL_SECONDS } from "../../../lib/session.js";
import { EmailProviderError, type EmailSender } from "../email/sender.js";
import { renderPasswordResetCodeEmail } from "./emails/password-reset-code.js";

interface SendPasswordResetCodeDeps {
  emailSender: EmailSender;
  log?: Pick<FastifyBaseLogger, "info" | "error"> | undefined;
}

interface SendPasswordResetCodeInput {
  to: string;
  code: string;
  passwordResetId: number;
}

// Resolves to whether the email was delivered and never rejects, which is
// what makes it safe to detach from the request with `void`. Provider bodies
// are not logged because they can echo the recipient address.
export async function sendPasswordResetCode(
  deps: SendPasswordResetCodeDeps,
  input: SendPasswordResetCodeInput,
): Promise<boolean> {
  try {
    const { providerMessageId } = await deps.emailSender.send({
      to: input.to,
      ...renderPasswordResetCodeEmail({
        code: input.code,
        ttlMinutes: PASSWORD_RESET_TTL_SECONDS / 60,
      }),
    });
    deps.log?.info(
      { passwordResetId: input.passwordResetId, providerMessageId },
      "password reset code email sent",
    );
    return true;
  } catch (error) {
    deps.log?.error(
      error instanceof EmailProviderError
        ? { err: error, providerStatus: error.status }
        : { err: error },
      "password reset code email delivery failed",
    );
    return false;
  }
}
