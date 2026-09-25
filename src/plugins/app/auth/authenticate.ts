import { hashSessionToken } from "../../../lib/token-hash.js";
import { hasExpired } from "../../../lib/ttl.js";
import type { SessionRepository } from "../sessions/repository.js";

export type AuthenticateResult =
  | { outcome: "authenticated"; user: { id: string }; session: { id: string } }
  | { outcome: "invalid" };

interface AuthenticateServiceDeps {
  repo: Pick<SessionRepository, "findSessionByTokenHash">;
  now?: () => Date;
}

export function createAuthenticateService(deps: AuthenticateServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async authenticate(token: string | undefined): Promise<AuthenticateResult> {
      if (!token) {
        return { outcome: "invalid" };
      }

      const session = await deps.repo.findSessionByTokenHash(
        hashSessionToken(token),
      );

      if (!session || hasExpired(session.expiresAt, now())) {
        return { outcome: "invalid" };
      }

      return {
        outcome: "authenticated",
        user: { id: session.userId },
        session: { id: session.id },
      };
    },
  };
}

export type AuthenticateService = ReturnType<typeof createAuthenticateService>;
