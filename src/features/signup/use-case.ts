import type { FastifyBaseLogger } from "fastify";
import { normalizeEmail } from "../../lib/email.js";
import { generateId } from "../../lib/id.js";
import { hashPassword } from "../../lib/password.js";
import { generateToken } from "../../lib/token.js";
import type { OtpModule } from "../../modules/otp/index.js";
import type { UsersModule } from "../../modules/users/index.js";
import type { CheckPwnedPassword } from "../../plugins/pwned-password/checker.js";
import type { TransactionRunner } from "../../plugins/transaction.js";

export type SignupResult =
  | { outcome: "accepted"; sessionToken: string }
  | { outcome: "pwned-password" };

interface SignupDeps {
  transaction: TransactionRunner;
  users: Pick<UsersModule, "findByEmail" | "inTx">;
  otp: Pick<OtpModule, "inTx" | "dispatch">;
  checkPwnedPassword: CheckPwnedPassword;
  log?: Pick<FastifyBaseLogger, "info">;
}

export function createSignup(deps: SignupDeps) {
  return async (rawEmail: string, password: string): Promise<SignupResult> => {
    const email = normalizeEmail(rawEmail);

    if (await deps.checkPwnedPassword(password)) {
      return { outcome: "pwned-password" };
    }

    // Hashed before any branch, so a new, a pending and a confirmed address
    // all pay for exactly one argon2 run and the response time says nothing
    // about which one it was.
    const passwordHash = await hashPassword(password);
    const existing = await deps.users.findByEmail(email);

    if (existing?.emailVerifiedAt) {
      // Confirmed account: nothing is written or delivered, but the response
      // (cookie included) must be indistinguishable.
      return { outcome: "accepted", sessionToken: generateToken() };
    }

    // The latest signup wins: an unconfirmed account takes the new password,
    // so someone who registered the address first cannot keep a password of
    // their own waiting for the owner to confirm it. Account and code are
    // written in the same transaction so a concurrent verification never
    // pairs the new password with an old token.
    const issued = await deps.transaction(async (tx) => {
      const started = await deps.users.inTx(tx).upsertUnverified({
        id: existing?.id ?? generateId(),
        email,
        passwordHash,
      });
      if (!started) {
        return null;
      }
      return deps.otp.inTx(tx).issue({ id: started.userId, email }, "signup");
    });

    if (!issued) {
      // Confirmed by a concurrent request between the read and the write.
      return { outcome: "accepted", sessionToken: generateToken() };
    }
    deps.otp.dispatch(issued);
    deps.log?.info({ userId: issued.userId }, "signup started");
    return { outcome: "accepted", sessionToken: issued.token };
  };
}
