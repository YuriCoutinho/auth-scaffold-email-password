import type { FastifyBaseLogger } from "fastify";
import { generateOtpCode } from "../../../lib/otp.js";
import { SIGNUP_TTL_SECONDS } from "../../../lib/session.js";
import { hashOtpCode } from "../../../lib/token-hash.js";
import {
  renderSignupCodeEmail,
  SIGNUP_CODE_EMAIL_TYPE,
} from "./emails/signup-code.js";
import type { AuthRepository } from "./repository.js";

export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_CODE_SEND_COUNT = 5;

export type ResendCodeResult =
  | { outcome: "sent"; sessionToken: string }
  | { outcome: "invalid-session" }
  | { outcome: "cooldown" }
  | { outcome: "limit-reached" };

interface ResendCodeServiceDeps {
  repo: Pick<
    AuthRepository,
    | "findPendingSignupBySessionToken"
    | "updatePendingSignupResendStateAndQueueEmail"
  >;
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

      // An undelivered code (see
      // AuthRepository.markPendingSignupUndeliveredIfCurrent) owes no cooldown.
      const withinCooldown =
        pending.codeSendCount > 0 &&
        currentTime.getTime() - pending.lastSentAt.getTime() <
          RESEND_COOLDOWN_SECONDS * 1000;
      if (withinCooldown) {
        return { outcome: "cooldown" };
      }

      const code = generateOtpCode();
      const codeHash = hashOtpCode(code);
      const expiresAt = new Date(
        currentTime.getTime() + SIGNUP_TTL_SECONDS * 1000,
      );
      // The new state and the message it announces are one write, so there is
      // nothing left to compensate if the provider is down later.
      await deps.repo.updatePendingSignupResendStateAndQueueEmail(
        sessionToken,
        {
          codeHash,
          expiresAt,
          codeAttempts: 0,
          lastSentAt: currentTime,
          codeSendCount: pending.codeSendCount + 1,
        },
        {
          type: SIGNUP_CODE_EMAIL_TYPE,
          recipient: pending.email,
          correlationId: codeHash,
          // The message dies with the code it carries, and this new code has
          // already invalidated the one still queued from the previous send.
          expiresAt,
          ...renderSignupCodeEmail({
            code,
            ttlMinutes: SIGNUP_TTL_SECONDS / 60,
          }),
        },
      );
      deps.log?.info(
        { pendingSignupId: pending.id },
        "signup code email queued",
      );

      return { outcome: "sent", sessionToken };
    },
  };
}

export type ResendCodeService = ReturnType<typeof createResendCodeService>;
