import type { FastifyBaseLogger } from "fastify";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "../../../lib/password.js";
import { generatePublicId } from "../../../lib/public-id.js";
import {
  generateSessionToken,
  SESSION_TTL_SECONDS,
} from "../../../lib/session.js";
import { hashSessionToken } from "../../../lib/token-hash.js";
import type { CredentialThrottle } from "../credential-throttle/create-credential-throttle.js";
import type { SessionRepository } from "../sessions/repository.js";
import type { AuthRepository } from "./repository.js";

export type LoginResult =
  | { outcome: "authenticated"; sessionToken: string }
  | { outcome: "invalid" }
  | { outcome: "throttled"; retryAfterSeconds: number };

interface LoginServiceDeps {
  repo: Pick<AuthRepository, "findAuthUserByEmail"> &
    Pick<SessionRepository, "createSession">;
  throttle: CredentialThrottle;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createLoginService(deps: LoginServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async login(
      rawEmail: string,
      password: string,
      deviceLabel: string | null,
    ): Promise<LoginResult> {
      const email = rawEmail.trim().toLowerCase();
      const currentTime = now();

      const throttleCheck = await deps.throttle.check(email);
      // Before the argon2 verification on purpose: the hash is expensive by
      // design, and a caller already blocked does not get to spend it.
      if (throttleCheck.outcome === "blocked") {
        return {
          outcome: "throttled",
          retryAfterSeconds: throttleCheck.retryAfterSeconds,
        };
      }

      const user = await deps.repo.findAuthUserByEmail(email);
      // No quick exit: always run exactly one argon2 verification so response
      // time does not reveal whether the email is registered.
      const passwordMatches = await verifyPassword(
        user?.passwordHash ?? DUMMY_PASSWORD_HASH,
        password,
      );

      if (!user || !passwordMatches) {
        await deps.throttle.registerFailure(email);
        deps.log?.warn(
          {
            userId: user?.id,
            reason: user ? "invalid_password" : "user_not_found",
          },
          "login failed",
        );
        return { outcome: "invalid" };
      }

      const sessionToken = generateSessionToken();
      await deps.repo.createSession({
        publicId: generatePublicId(),
        userId: user.id,
        tokenHash: hashSessionToken(sessionToken),
        deviceLabel,
        expiresAt: new Date(currentTime.getTime() + SESSION_TTL_SECONDS * 1000),
      });
      await deps.throttle.reset(email);
      deps.log?.info({ userId: user.id }, "login succeeded");

      return { outcome: "authenticated", sessionToken };
    },
  };
}

export type LoginService = ReturnType<typeof createLoginService>;
