import type { FastifyBaseLogger } from "fastify";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import type { CredentialThrottleService } from "../../modules/credential-throttle/service.js";
import type { SessionsModule } from "../../modules/sessions/index.js";
import type { UsersModule } from "../../modules/users/index.js";
import type { CheckPwnedPassword } from "../../plugins/pwned-password/checker.js";
import type { TransactionRunner } from "../../plugins/transaction.js";

export type ChangePasswordResult =
  | { outcome: "changed" }
  | { outcome: "invalid-current-password" }
  | { outcome: "same-password" }
  | { outcome: "pwned-password" }
  | { outcome: "throttled"; retryAfterSeconds: number };

export interface ChangePasswordInput {
  userId: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
}

interface ChangePasswordDeps {
  transaction: TransactionRunner;
  users: Pick<UsersModule, "findById" | "inTx" | "notifyPasswordChanged">;
  sessions: Pick<SessionsModule, "inTx">;
  credentialThrottle: Pick<
    CredentialThrottleService,
    "check" | "registerFailure" | "reset"
  >;
  checkPwnedPassword: CheckPwnedPassword;
  log?: Pick<FastifyBaseLogger, "info" | "warn">;
}

export function createChangePassword(deps: ChangePasswordDeps) {
  return async (input: ChangePasswordInput): Promise<ChangePasswordResult> => {
    const user = await deps.users.findById(input.userId);
    if (!user) {
      deps.log?.warn(
        { userId: input.userId, reason: "invalid_current_password" },
        "password change failed",
      );
      return { outcome: "invalid-current-password" };
    }

    // Same key space as login, so alternating between the two endpoints does
    // not hand an attacker a second budget of free attempts.
    const throttleCheck = await deps.credentialThrottle.check(user.email);
    if (throttleCheck.outcome === "blocked") {
      return {
        outcome: "throttled",
        retryAfterSeconds: throttleCheck.retryAfterSeconds,
      };
    }

    // Proof of possession comes first: the breach lookup is an outbound
    // call, and nobody gets to spend it by guessing with a stolen cookie.
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      await deps.credentialThrottle.registerFailure(user.email);
      deps.log?.warn(
        { userId: input.userId, reason: "invalid_current_password" },
        "password change failed",
      );
      return { outcome: "invalid-current-password" };
    }

    await deps.credentialThrottle.reset(user.email);

    if (input.newPassword === input.currentPassword) {
      return { outcome: "same-password" };
    }

    if (await deps.checkPwnedPassword(input.newPassword)) {
      return { outcome: "pwned-password" };
    }

    const passwordHash = await hashPassword(input.newPassword);
    // One transaction so the two writes cannot come apart: a new password with
    // the old sessions still alive is the exact state this flow prevents.
    await deps.transaction(async (tx) => {
      await deps.sessions.inTx(tx).endAllOfUser({
        userId: user.id,
        exceptSessionId: input.currentSessionId,
      });
      await deps.users.inTx(tx).setPasswordHash(user.id, passwordHash);
    });
    deps.log?.info({ userId: user.id }, "password changed");

    deps.users.notifyPasswordChanged({ to: user.email, userId: user.id });

    return { outcome: "changed" };
  };
}
