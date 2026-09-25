import type { FastifyBaseLogger } from "fastify";
import {
  EmailProviderError,
  type EmailSender,
} from "../../../plugins/email/sender.js";

export interface PasswordChangedEmailContent {
  subject: string;
  html: string;
  text: string;
}

// No link, even though the recovery flow now exists: a security notice that
// trains the reader to click links inside it is the habit phishing exploits.
// With no dynamic value, the template has nothing to escape.
export function renderPasswordChangedEmail(): PasswordChangedEmailContent {
  const notice =
    "Every other device was signed out. If this wasn't you, reset your password from the sign-in page right away to take the account back.";

  return {
    subject: "Your password was changed",
    html: [
      '<div style="max-width: 480px; margin: 0 auto; padding: 24px; font-family: Arial, Helvetica, sans-serif; color: #1a1a1a;">',
      '  <p style="margin: 0 0 16px;">The password for your account was just changed.</p>',
      `  <p style="margin: 0; color: #555555;">${notice}</p>`,
      "</div>",
    ].join("\n"),
    text: ["The password for your account was just changed.", "", notice].join(
      "\n",
    ),
  };
}

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
