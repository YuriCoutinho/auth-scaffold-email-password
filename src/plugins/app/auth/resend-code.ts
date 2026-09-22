import type { FastifyBaseLogger } from "fastify";
import { generateOtpCode } from "../../../lib/otp.js";
import { SIGNUP_TTL_SECONDS } from "../../../lib/session.js";
import { hashOtpCode } from "../../../lib/token-hash.js";
import type { EmailSender } from "../email/sender.js";
import type { AuthRepository } from "./repository.js";
import { sendSignupCode } from "./send-signup-code.js";

export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_CODE_SEND_COUNT = 5;

export type ResendCodeResult =
  | { outcome: "sent"; sessionToken: string }
  | { outcome: "invalid-session" }
  | { outcome: "cooldown" }
  | { outcome: "limit-reached" }
  | { outcome: "email-unavailable" };

interface ResendCodeServiceDeps {
  repo: Pick<
    AuthRepository,
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

      // An undelivered code (see AuthRepository.markPendingSignupUndelivered)
      // owes no cooldown.
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

      const delivered = await sendSignupCode(
        { emailSender: deps.emailSender, log: deps.log },
        { to: pending.email, code, pendingSignupId: pending.id },
      );
      if (!delivered) {
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

      return { outcome: "sent", sessionToken };
    },
  };
}

export type ResendCodeService = ReturnType<typeof createResendCodeService>;
