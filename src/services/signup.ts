import type { FastifyBaseLogger } from "fastify";
import type { SignupRepo } from "../db/signup-repo.js";
import { generateOtpCode, generateSignupSessionToken } from "../lib/otp.js";
import { hashPassword } from "../lib/password.js";
import type { CheckPwnedPassword } from "../lib/pwned-password.js";
import { hashOtpCode } from "../lib/token-hash.js";
import { EmailProviderError, type EmailSender } from "./email-sender.js";
import { renderSignupCodeEmail } from "./signup-email.js";

export const SIGNUP_TTL_SECONDS = 15 * 60;

export type SignupResult =
  | { outcome: "accepted"; sessionToken: string }
  | { outcome: "pwned-password" }
  | { outcome: "email-unavailable" };

interface SignupServiceDeps {
  repo: Pick<
    SignupRepo,
    | "findAuthUserByEmail"
    | "findPendingSignupByEmail"
    | "upsertPendingSignup"
    | "resetPendingSignupSendState"
  >;
  emailSender: EmailSender;
  checkPwnedPassword: CheckPwnedPassword;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createSignupService(deps: SignupServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async signup(rawEmail: string, password: string): Promise<SignupResult> {
      const email = rawEmail.trim().toLowerCase();

      if (await deps.checkPwnedPassword(password)) {
        return { outcome: "pwned-password" };
      }

      const currentTime = now();

      if (await deps.repo.findAuthUserByEmail(email)) {
        // Confirmed account: no code is generated or delivered, but the
        // response (cookie included) must be indistinguishable.
        return {
          outcome: "accepted",
          sessionToken: generateSignupSessionToken(),
        };
      }

      const pending = await deps.repo.findPendingSignupByEmail(email);
      if (pending && pending.expiresAt > currentTime) {
        return {
          outcome: "accepted",
          sessionToken: pending.signupSessionToken,
        };
      }

      const code = generateOtpCode();
      const sessionToken = generateSignupSessionToken();
      const { id: pendingSignupId } = await deps.repo.upsertPendingSignup({
        email,
        passwordHash: await hashPassword(password),
        codeHash: hashOtpCode(code),
        signupSessionToken: sessionToken,
        expiresAt: new Date(currentTime.getTime() + SIGNUP_TTL_SECONDS * 1000),
        now: currentTime,
      });

      try {
        const { providerMessageId } = await deps.emailSender.send({
          to: email,
          ...renderSignupCodeEmail({
            code,
            ttlMinutes: SIGNUP_TTL_SECONDS / 60,
          }),
        });
        deps.log?.info(
          { pendingSignupId, providerMessageId },
          "signup code email sent",
        );
      } catch (error) {
        deps.log?.error(
          error instanceof EmailProviderError
            ? {
                err: error,
                providerStatus: error.status,
                providerBody: error.body,
              }
            : { err: error },
          "signup code email delivery failed",
        );
        // Failed delivery must not consume resend quota; reset is best-effort.
        try {
          await deps.repo.resetPendingSignupSendState(email);
        } catch (resetError) {
          deps.log?.warn(
            { err: resetError },
            "failed to reset pending signup send state",
          );
        }
        return { outcome: "email-unavailable" };
      }

      return { outcome: "accepted", sessionToken };
    },
  };
}

export type SignupService = ReturnType<typeof createSignupService>;
