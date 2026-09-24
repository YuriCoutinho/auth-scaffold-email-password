import type { FastifyBaseLogger } from "fastify";
import { generateOtpCode } from "../../../lib/otp.js";
import {
  generatePasswordResetSessionToken,
  PASSWORD_RESET_TTL_SECONDS,
} from "../../../lib/session.js";
import { hashOtpCode } from "../../../lib/token-hash.js";
import type { EmailSender } from "../email/sender.js";
import type { AuthRepository, PasswordResetSendState } from "./repository.js";
import { MAX_CODE_SEND_COUNT, RESEND_COOLDOWN_SECONDS } from "./resend-code.js";
import { sendPasswordResetCode } from "./send-password-reset-code.js";

interface ForgotPasswordServiceDeps {
  repo: Pick<
    AuthRepository,
    | "findAuthUserByEmail"
    | "findPasswordResetByUserId"
    | "upsertPasswordReset"
    | "updatePasswordResetSendState"
  >;
  emailSender: EmailSender;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createForgotPasswordService(deps: ForgotPasswordServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    // One outcome on purpose: the response is a fixed 202 whether or not the
    // address has an account, so there is nothing for the route to branch on.
    async forgotPassword(rawEmail: string): Promise<{ sessionToken: string }> {
      const email = rawEmail.trim().toLowerCase();
      const currentTime = now();

      const user = await deps.repo.findAuthUserByEmail(email);
      if (!user) {
        // No account: a throwaway token keeps the response identical, and it
        // matches no row, so /auth/reset-password rejects it like any other
        // unknown token.
        return { sessionToken: generatePasswordResetSessionToken() };
      }

      const existing = await deps.repo.findPasswordResetByUserId(user.id);
      const live =
        existing && existing.expiresAt > currentTime ? existing : undefined;

      if (live) {
        const capped = live.codeSendCount >= MAX_CODE_SEND_COUNT;
        const withinCooldown =
          live.codeSendCount > 0 &&
          currentTime.getTime() - live.lastSentAt.getTime() <
            RESEND_COOLDOWN_SECONDS * 1000;
        if (capped || withinCooldown) {
          // Nothing is sent, and the token of the live row goes back out so
          // the code already sitting in the mailbox keeps working.
          return { sessionToken: live.resetSessionToken };
        }
      }

      const code = generateOtpCode();
      const expiresAt = new Date(
        currentTime.getTime() + PASSWORD_RESET_TTL_SECONDS * 1000,
      );

      // Snapshot before writing. A failed delivery restores this, which
      // decrements the send count instead of zeroing it: unlike signup, this
      // endpoint is also its own resend, so zeroing would refund the cap.
      const previous: PasswordResetSendState = live
        ? {
            codeHash: live.codeHash,
            expiresAt: live.expiresAt,
            codeAttempts: live.codeAttempts,
            lastSentAt: live.lastSentAt,
            codeSendCount: live.codeSendCount,
          }
        : {
            codeHash: hashOtpCode(code),
            expiresAt,
            codeAttempts: 0,
            lastSentAt: currentTime,
            codeSendCount: 0,
          };

      let sessionToken: string;
      let passwordResetId: number;

      if (live) {
        sessionToken = live.resetSessionToken;
        passwordResetId = live.id;
        await deps.repo.updatePasswordResetSendState(sessionToken, {
          codeHash: hashOtpCode(code),
          expiresAt,
          codeAttempts: 0,
          lastSentAt: currentTime,
          codeSendCount: live.codeSendCount + 1,
        });
      } else {
        sessionToken = generatePasswordResetSessionToken();
        const { id } = await deps.repo.upsertPasswordReset({
          userId: user.id,
          codeHash: hashOtpCode(code),
          resetSessionToken: sessionToken,
          expiresAt,
          now: currentTime,
        });
        passwordResetId = id;
      }

      // Detached on purpose. The response is a fixed 202, so awaiting the
      // provider buys nothing and costs everything: a known address would take
      // the provider's time while an unknown one answers instantly, which is
      // account enumeration by stopwatch. The helper never rejects, and the
      // compensation runs after the response instead of before it.
      void sendPasswordResetCode(
        { emailSender: deps.emailSender, log: deps.log },
        { to: email, code, passwordResetId },
      )
        .then((delivered) => {
          if (delivered) {
            return;
          }
          return deps.repo.updatePasswordResetSendState(sessionToken, previous);
        })
        .catch((restoreError) => {
          deps.log?.warn(
            { err: restoreError },
            "failed to restore password reset state after delivery failure",
          );
        });

      return { sessionToken };
    },
  };
}

export type ForgotPasswordService = ReturnType<
  typeof createForgotPasswordService
>;
