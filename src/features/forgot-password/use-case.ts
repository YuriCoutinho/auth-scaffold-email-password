import { normalizeEmail } from "../../lib/email.js";
import { generateToken } from "../../lib/token.js";
import type { OtpModule } from "../../modules/otp/index.js";
import type { UsersModule } from "../../modules/users/index.js";

interface ForgotPasswordDeps {
  users: Pick<UsersModule, "findByEmail">;
  otp: Pick<OtpModule, "issue" | "dispatch">;
}

export function createForgotPassword(deps: ForgotPasswordDeps) {
  // One outcome on purpose: the response is a fixed 202 whether or not the
  // address has an account, so there is nothing for the route to branch on.
  return async (rawEmail: string): Promise<{ sessionToken: string }> => {
    const email = normalizeEmail(rawEmail);

    const user = await deps.users.findByEmail(email);
    if (!user?.emailVerifiedAt) {
      // No confirmed account: a throwaway token keeps the response
      // identical, and it matches no row, so /auth/reset-password rejects it
      // like any other unknown token.
      return { sessionToken: generateToken() };
    }

    // A single table is written, so there is no transaction to wait for and
    // the code can be dispatched right away.
    const issued = await deps.otp.issue(user, "password_reset");
    deps.otp.dispatch(issued);
    return { sessionToken: issued.token };
  };
}
