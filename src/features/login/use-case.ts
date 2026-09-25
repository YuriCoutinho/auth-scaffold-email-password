import type { FastifyBaseLogger } from "fastify";
import { normalizeEmail } from "../../lib/email.js";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "../../lib/password.js";
import type { CredentialThrottleService } from "../../modules/credential-throttle/service.js";
import type { SessionsModule } from "../../modules/sessions/index.js";
import type { UsersModule } from "../../modules/users/index.js";

export type LoginResult =
  | { outcome: "authenticated"; sessionToken: string }
  | { outcome: "invalid" }
  | { outcome: "throttled"; retryAfterSeconds: number };

interface LoginDeps {
  users: Pick<UsersModule, "findByEmail">;
  sessions: Pick<SessionsModule, "issue">;
  credentialThrottle: Pick<
    CredentialThrottleService,
    "check" | "registerFailure" | "reset"
  >;
  log?: Pick<FastifyBaseLogger, "info" | "warn">;
}

export function createLogin(deps: LoginDeps) {
  return async (
    rawEmail: string,
    password: string,
    deviceLabel: string | null,
  ): Promise<LoginResult> => {
    const email = normalizeEmail(rawEmail);

    const throttleCheck = await deps.credentialThrottle.check(email);
    // Before the argon2 verification on purpose: the hash is expensive by
    // design, and a caller already blocked does not get to spend it.
    if (throttleCheck.outcome === "blocked") {
      return {
        outcome: "throttled",
        retryAfterSeconds: throttleCheck.retryAfterSeconds,
      };
    }

    const found = await deps.users.findByEmail(email);
    // An unconfirmed account cannot sign in, and it answers exactly like an
    // unknown address.
    const user = found?.emailVerifiedAt ? found : undefined;
    // No quick exit: always run exactly one argon2 verification so response
    // time does not reveal whether the email is registered.
    const passwordMatches = await verifyPassword(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );

    if (!user || !passwordMatches) {
      await deps.credentialThrottle.registerFailure(email);
      deps.log?.warn(
        {
          userId: user?.id,
          reason: user ? "invalid_password" : "user_not_found",
        },
        "login failed",
      );
      return { outcome: "invalid" };
    }

    const sessionToken = await deps.sessions.issue({
      userId: user.id,
      deviceLabel,
    });
    await deps.credentialThrottle.reset(email);
    deps.log?.info({ userId: user.id }, "login succeeded");

    return { outcome: "authenticated", sessionToken };
  };
}
