import { hashSessionToken } from "../../../lib/token-hash.js";
import type { AuthRepository } from "./repository.js";

export type AuthenticateResult =
  | { outcome: "authenticated"; user: { id: number } }
  | { outcome: "invalid" };

interface AuthenticateServiceDeps {
  repo: Pick<AuthRepository, "findSessionByTokenHash">;
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

      if (!session || session.revokedAt !== null) {
        return { outcome: "invalid" };
      }

      if (session.expiresAt.getTime() <= now().getTime()) {
        return { outcome: "invalid" };
      }

      return { outcome: "authenticated", user: { id: session.userId } };
    },
  };
}

export type AuthenticateService = ReturnType<typeof createAuthenticateService>;
