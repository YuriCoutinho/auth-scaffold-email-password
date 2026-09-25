import type { FastifyBaseLogger } from "fastify";
import { generateId } from "../../../lib/id.js";
import { hashPassword, verifyPassword } from "../../../lib/password.js";
import { generateToken } from "../../../lib/session.js";
import { hashSessionToken } from "../../../lib/token-hash.js";
import { expiresAt } from "../../../lib/ttl.js";
import type { EmailSender } from "../../email/sender.js";
import type { CheckPwnedPassword } from "../../pwned-password/checker.js";
import type { CredentialThrottle } from "../credential-throttle/create-credential-throttle.js";
import type { AuthRepository } from "./repository.js";
import { sendPasswordChanged } from "./send-password-changed.js";
import type { VerificationCodes } from "./verification-codes.js";

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
  repo: Pick<AuthRepository, "resetPassword">;
  codes: Pick<VerificationCodes, "verify">;
  emailSender: EmailSender;
  checkPwnedPassword: CheckPwnedPassword;
  throttle: CredentialThrottle;
  sessionTtlSeconds: number;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createResetPasswordService(deps: ResetPasswordServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async resetPassword(
      input: ResetPasswordInput,
    ): Promise<ResetPasswordResult> {
      const result = await deps.codes.verify(
        "password_reset",
        input.sessionToken,
        input.code,
      );
      if (result.outcome === "invalid") {
        return result;
      }
      const reset = result.code;

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

      const sessionToken = generateToken();
      const currentTime = now();
      const applied = await deps.repo.resetPassword({
        userId: reset.userId,
        tokenHash: reset.tokenHash,
        codeHash: reset.codeHash,
        passwordHash: await hashPassword(input.newPassword),
        session: {
          id: generateId(),
          tokenHash: hashSessionToken(sessionToken),
          deviceLabel: input.deviceLabel,
          createdAt: currentTime,
          expiresAt: expiresAt(currentTime, deps.sessionTtlSeconds),
        },
      });
      if (!applied) {
        deps.log?.info(
          { userId: reset.userId },
          "password reset code already consumed by a concurrent request",
        );
        return { outcome: "invalid" };
      }
      // Proving possession of the email outranks the failed-attempt count, so
      // a reset frees the account the way a successful login does. Without it
      // the owner would finish the reset and still be locked out.
      await deps.throttle.reset(reset.email);
      deps.log?.info({ userId: reset.userId }, "password reset");

      // Detached: the password is already changed, so delivery cannot decide
      // the response, and an email in the request path is an email the caller
      // waits on for nothing.
      void sendPasswordChanged(
        { emailSender: deps.emailSender, log: deps.log },
        { to: reset.email, userId: reset.userId },
      ).catch((sendError) => {
        deps.log?.warn(
          { err: sendError },
          "failed to send the password changed email",
        );
      });

      return { outcome: "reset", sessionToken };
    },
  };
}

export type ResetPasswordService = ReturnType<
  typeof createResetPasswordService
>;
