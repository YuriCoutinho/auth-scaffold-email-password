import type { FastifyBaseLogger } from "fastify";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import type { CredentialThrottleService } from "../../modules/credential-throttle/service.js";
import type { OtpModule } from "../../modules/otp/index.js";
import type { SessionsModule } from "../../modules/sessions/index.js";
import type { UsersModule } from "../../modules/users/index.js";
import type { CheckPwnedPassword } from "../../plugins/pwned-password/checker.js";
import type { TransactionRunner } from "../../plugins/transaction.js";

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

interface ResetPasswordDeps {
  transaction: TransactionRunner;
  otp: Pick<OtpModule, "verify" | "inTx">;
  users: Pick<UsersModule, "inTx" | "notifyPasswordChanged">;
  sessions: Pick<SessionsModule, "inTx">;
  credentialThrottle: Pick<CredentialThrottleService, "reset">;
  checkPwnedPassword: CheckPwnedPassword;
  log?: Pick<FastifyBaseLogger, "info">;
}

export function createResetPassword(deps: ResetPasswordDeps) {
  return async (input: ResetPasswordInput): Promise<ResetPasswordResult> => {
    const result = await deps.otp.verify(
      "password_reset",
      input.sessionToken,
      input.code,
    );
    if (result.outcome === "invalid") {
      return result;
    }
    const { userId, tokenHash, codeHash, email, passwordHash } = result.code;

    // Neither refusal below counts as an attempt or drops the row: attempts
    // track wrong codes, not bad password choices, so the caller retries
    // with the code still in hand. The local comparison comes first because
    // the breach lookup is an outbound call.
    if (await verifyPassword(passwordHash, input.newPassword)) {
      return { outcome: "same-password" };
    }

    if (await deps.checkPwnedPassword(input.newPassword)) {
      return { outcome: "pwned-password" };
    }

    const newPasswordHash = await hashPassword(input.newPassword);
    // All-or-nothing: if anything fails, the code survives for a retry.
    const sessionToken = await deps.transaction(async (tx) => {
      if (
        !(await deps.otp
          .inTx(tx)
          .consume("password_reset", { userId, tokenHash, codeHash }))
      ) {
        return null;
      }
      // Every session goes before the insert so the session this flow opens is
      // not caught by its own sweep.
      await deps.sessions.inTx(tx).endAllOfUser({ userId });
      await deps.users.inTx(tx).setPasswordHash(userId, newPasswordHash);
      return deps.sessions
        .inTx(tx)
        .issue({ userId, deviceLabel: input.deviceLabel });
    });
    if (!sessionToken) {
      deps.log?.info(
        { userId },
        "password reset code already consumed by a concurrent request",
      );
      return { outcome: "invalid" };
    }
    // Proving possession of the email outranks the failed-attempt count, so
    // a reset frees the account the way a successful login does. Without it
    // the owner would finish the reset and still be locked out.
    await deps.credentialThrottle.reset(email);
    deps.log?.info({ userId }, "password reset");

    deps.users.notifyPasswordChanged({ to: email, userId });

    return { outcome: "reset", sessionToken };
  };
}
