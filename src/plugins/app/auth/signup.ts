import type { FastifyBaseLogger } from "fastify";
import { normalizeEmail } from "../../../lib/email.js";
import { generateId } from "../../../lib/id.js";
import { hashPassword } from "../../../lib/password.js";
import { generateToken } from "../../../lib/session.js";
import type { CheckPwnedPassword } from "../../pwned-password/checker.js";
import type { AuthRepository } from "./repository.js";
import type { VerificationCodes } from "./verification-codes.js";

export type SignupResult =
  | { outcome: "accepted"; sessionToken: string }
  | { outcome: "pwned-password" };

interface SignupServiceDeps {
  repo: Pick<AuthRepository, "findUserByEmail">;
  codes: Pick<VerificationCodes, "startSignup">;
  checkPwnedPassword: CheckPwnedPassword;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
}

export function createSignupService(deps: SignupServiceDeps) {
  return {
    async signup(rawEmail: string, password: string): Promise<SignupResult> {
      const email = normalizeEmail(rawEmail);

      if (await deps.checkPwnedPassword(password)) {
        return { outcome: "pwned-password" };
      }

      // Hashed before any branch, so a new, a pending and a confirmed address
      // all pay for exactly one argon2 run and the response time says nothing
      // about which one it was.
      const passwordHash = await hashPassword(password);
      const user = await deps.repo.findUserByEmail(email);

      if (user?.emailVerifiedAt) {
        // Confirmed account: nothing is written or delivered, but the response
        // (cookie included) must be indistinguishable.
        return { outcome: "accepted", sessionToken: generateToken() };
      }

      // The latest signup wins: an unconfirmed account takes the new password,
      // so someone who registered the address first cannot keep a password of
      // their own waiting for the owner to confirm it.
      const started = await deps.codes.startSignup({
        id: user?.id ?? generateId(),
        email,
        passwordHash,
      });
      if (!started) {
        // Confirmed by a concurrent request between the read and the write.
        return { outcome: "accepted", sessionToken: generateToken() };
      }
      deps.log?.info({ userId: started.userId }, "signup started");
      return { outcome: "accepted", sessionToken: started.token };
    },
  };
}

export type SignupService = ReturnType<typeof createSignupService>;
