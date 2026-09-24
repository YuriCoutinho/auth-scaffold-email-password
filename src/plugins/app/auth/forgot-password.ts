import { generateToken } from "../../../lib/session.js";
import type { AuthRepository } from "./repository.js";
import type { VerificationCodes } from "./verification-codes.js";

interface ForgotPasswordServiceDeps {
  repo: Pick<AuthRepository, "findUserByEmail">;
  codes: Pick<VerificationCodes, "request">;
}

export function createForgotPasswordService(deps: ForgotPasswordServiceDeps) {
  return {
    // One outcome on purpose: the response is a fixed 202 whether or not the
    // address has an account, so there is nothing for the route to branch on.
    async forgotPassword(rawEmail: string): Promise<{ sessionToken: string }> {
      const email = rawEmail.trim().toLowerCase();

      const user = await deps.repo.findUserByEmail(email);
      if (!user?.emailVerifiedAt) {
        // No confirmed account: a throwaway token keeps the response
        // identical, and it matches no row, so /auth/reset-password rejects it
        // like any other unknown token.
        return { sessionToken: generateToken() };
      }

      return {
        sessionToken: await deps.codes.request(user, "password_reset"),
      };
    },
  };
}

export type ForgotPasswordService = ReturnType<
  typeof createForgotPasswordService
>;
