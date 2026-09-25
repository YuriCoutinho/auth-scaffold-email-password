import type { FastifyBaseLogger } from "fastify";
import type { OtpModule } from "../../modules/otp/index.js";
import type { SessionsModule } from "../../modules/sessions/index.js";
import type { UsersModule } from "../../modules/users/index.js";
import { rollback, type TransactionRunner } from "../../plugins/transaction.js";

export type VerifySignupResult =
  | { outcome: "verified"; sessionToken: string }
  | { outcome: "invalid" };

interface VerifySignupDeps {
  transaction: TransactionRunner;
  otp: Pick<OtpModule, "verify" | "inTx">;
  users: Pick<UsersModule, "inTx">;
  sessions: Pick<SessionsModule, "inTx">;
  log?: Pick<FastifyBaseLogger, "info">;
  now?: () => Date;
}

export function createVerifySignup(deps: VerifySignupDeps) {
  const now = deps.now ?? (() => new Date());

  return async (
    sessionToken: string | undefined,
    code: string,
    deviceLabel: string | null,
  ): Promise<VerifySignupResult> => {
    const result = await deps.otp.verify("signup", sessionToken, code);
    if (result.outcome === "invalid") {
      return result;
    }
    const { userId, tokenHash, codeHash } = result.code;

    // All-or-nothing: if anything fails, the code survives for a retry.
    const newSessionToken = await deps.transaction(async (tx) => {
      // Consuming first makes the code row the serialization point: a second
      // request carrying the same code blocks on this delete and then matches
      // nothing.
      if (
        !(await deps.otp
          .inTx(tx)
          .consume("signup", { userId, tokenHash, codeHash }))
      ) {
        return null;
      }
      if (!(await deps.users.inTx(tx).markVerified(userId, now()))) {
        // A leftover signup code of a confirmed account must never turn
        // into a session without a password.
        return rollback(null);
      }
      return deps.sessions.inTx(tx).issue({ userId, deviceLabel });
    });

    if (!newSessionToken) {
      deps.log?.info(
        { userId },
        "signup code already consumed by a concurrent request",
      );
      return { outcome: "invalid" };
    }
    deps.log?.info({ userId }, "email verified");
    return { outcome: "verified", sessionToken: newSessionToken };
  };
}
