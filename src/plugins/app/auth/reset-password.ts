import type { FastifyBaseLogger } from "fastify";
import { hashPassword, verifyPassword } from "../../../lib/password.js";
import {
  generateSessionToken,
  SESSION_TTL_SECONDS,
} from "../../../lib/session.js";
import { hashOtpCode, hashSessionToken } from "../../../lib/token-hash.js";
import type { EmailSender } from "../email/sender.js";
import type { CheckPwnedPassword } from "../pwned-password/checker.js";
import type { AuthRepository } from "./repository.js";
import { sendPasswordChanged } from "./send-password-changed.js";
import { MAX_CODE_ATTEMPTS } from "./verify-code.js";

export type ResetPasswordResult =
  | { outcome: "reset"; sessionToken: string }
  | { outcome: "invalid" }
  | { outcome: "same-password" }
  | { outcome: "pwned-password" };

export interface ResetPasswordInput {
  sessionToken: string | undefined;
  code: string;
  newPassword: string;
  deviceLabel: string | null;
}

interface ResetPasswordServiceDeps {
  repo: Pick<
    AuthRepository,
    | "findPasswordResetBySessionToken"
    | "incrementPasswordResetAttempts"
    | "resetUserPassword"
  >;
  emailSender: EmailSender;
  checkPwnedPassword: CheckPwnedPassword;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createResetPasswordService(deps: ResetPasswordServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async resetPassword(
      input: ResetPasswordInput,
    ): Promise<ResetPasswordResult> {
      if (!input.sessionToken) {
        return { outcome: "invalid" };
      }

      const currentTime = now();
      const reset = await deps.repo.findPasswordResetBySessionToken(
        input.sessionToken,
      );
      // A token minted for an address with no account matches no row and dies
      // here, which is the same answer a wrong code gets.
      if (!reset || reset.expiresAt <= currentTime) {
        return { outcome: "invalid" };
      }

      // Exhausted codes stay unusable even if the right code shows up later;
      // asking for another one or waiting for expiry are the only ways out.
      if (reset.codeAttempts >= MAX_CODE_ATTEMPTS) {
        return { outcome: "invalid" };
      }

      if (hashOtpCode(input.code) !== reset.codeHash) {
        await deps.repo.incrementPasswordResetAttempts(input.sessionToken);
        const attempts = reset.codeAttempts + 1;
        deps.log?.warn(
          { passwordResetId: reset.id, codeAttempts: attempts },
          attempts >= MAX_CODE_ATTEMPTS
            ? "password reset code invalidated after too many failed attempts"
            : "password reset code verification failed",
        );
        return { outcome: "invalid" };
      }

      // Neither refusal below counts as an attempt or drops the row: attempts
      // track wrong codes, not bad password choices, so the caller retries
      // with the code still in hand. The local comparison comes first because
      // the breach lookup is an outbound call.
      if (await verifyPassword(reset.passwordHash, input.newPassword)) {
        return { outcome: "same-password" };
      }

      if (await deps.checkPwnedPassword(input.newPassword)) {
        return { outcome: "pwned-password" };
      }

      const sessionToken = generateSessionToken();
      await deps.repo.resetUserPassword({
        userId: reset.userId,
        passwordHash: await hashPassword(input.newPassword),
        resetSessionToken: input.sessionToken,
        sessionTokenHash: hashSessionToken(sessionToken),
        deviceLabel: input.deviceLabel,
        sessionExpiresAt: new Date(
          currentTime.getTime() + SESSION_TTL_SECONDS * 1000,
        ),
        revokedAt: currentTime,
        revokedReason: "password_reset",
      });
      deps.log?.info({ userId: reset.userId }, "password reset");

      // Detached: the password is already changed, so delivery cannot decide
      // the response, and an email in the request path is an email the caller
      // waits on for nothing.
      void sendPasswordChanged(
        { emailSender: deps.emailSender, log: deps.log },
        { to: reset.email, userId: reset.userId },
      );

      return { outcome: "reset", sessionToken };
    },
  };
}

export type ResetPasswordService = ReturnType<
  typeof createResetPasswordService
>;
