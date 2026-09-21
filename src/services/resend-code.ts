import type { FastifyBaseLogger } from "fastify";
import type { SignupRepo } from "../db/signup-repo.js";
import { generateOtpCode } from "../lib/otp.js";
import { hashOtpCode } from "../lib/token-hash.js";
import { EmailProviderError, type EmailSender } from "./email-sender.js";
import { SIGNUP_TTL_SECONDS } from "./signup.js";
import { renderSignupCodeEmail } from "./signup-email.js";

export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_CODE_SEND_COUNT = 5;

export type ResendCodeResult =
  | { outcome: "sent" }
  | { outcome: "invalid-session" }
  | { outcome: "cooldown" }
  | { outcome: "limit-reached" }
  | { outcome: "email-unavailable" };

interface ResendCodeServiceDeps {
  repo: Pick<
    SignupRepo,
    "findPendingSignupBySessionToken" | "updatePendingSignupResendState"
  >;
  emailSender: EmailSender;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createResendCodeService(deps: ResendCodeServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async resendCode(
      sessionToken: string | undefined,
    ): Promise<ResendCodeResult> {
      if (!sessionToken) {
        return { outcome: "invalid-session" };
      }

      const currentTime = now();
      const pending =
        await deps.repo.findPendingSignupBySessionToken(sessionToken);
      if (!pending || pending.expiresAt <= currentTime) {
        return { outcome: "invalid-session" };
      }

      if (pending.codeSendCount >= MAX_CODE_SEND_COUNT) {
        return { outcome: "limit-reached" };
      }

      // code_send_count = 0 means no email was delivered for the current
      // code (compensated failure), so no cooldown applies.
      const withinCooldown =
        pending.codeSendCount > 0 &&
        currentTime.getTime() - pending.lastSentAt.getTime() <
          RESEND_COOLDOWN_SECONDS * 1000;
      if (withinCooldown) {
        return { outcome: "cooldown" };
      }

      const code = generateOtpCode();
      const previousState = {
        codeHash: pending.codeHash,
        expiresAt: pending.expiresAt,
        codeAttempts: pending.codeAttempts,
        lastSentAt: pending.lastSentAt,
        codeSendCount: pending.codeSendCount,
      };

      await deps.repo.updatePendingSignupResendState(sessionToken, {
        codeHash: hashOtpCode(code),
        expiresAt: new Date(currentTime.getTime() + SIGNUP_TTL_SECONDS * 1000),
        codeAttempts: 0,
        lastSentAt: currentTime,
        codeSendCount: pending.codeSendCount + 1,
      });

      try {
        const { providerMessageId } = await deps.emailSender.send({
          to: pending.email,
          ...renderSignupCodeEmail({
            code,
            ttlMinutes: SIGNUP_TTL_SECONDS / 60,
          }),
        });
        deps.log?.info(
          { pendingSignupId: pending.id, providerMessageId },
          "signup code email resent",
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
          "signup code email resend failed",
        );
        // Failed delivery must not consume quota nor start a cooldown; the
        // previous code becomes valid again. Restore is best-effort.
        try {
          await deps.repo.updatePendingSignupResendState(
            sessionToken,
            previousState,
          );
        } catch (restoreError) {
          deps.log?.warn(
            { err: restoreError },
            "failed to restore pending signup state after resend failure",
          );
        }
        return { outcome: "email-unavailable" };
      }

      return { outcome: "sent" };
    },
  };
}

export type ResendCodeService = ReturnType<typeof createResendCodeService>;
