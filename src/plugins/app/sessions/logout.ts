import { hashSessionToken } from "../../../lib/token-hash.js";
import type { SessionRepository } from "./repository.js";

interface LogoutServiceDeps {
  repo: Pick<SessionRepository, "revokeSessionByTokenHash">;
  now?: () => Date;
}

export function createLogoutService(deps: LogoutServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    // Resolves the same way whether a session was revoked or not: the caller
    // answers 204 either way, and telling it apart would leak whether that
    // cookie named a real session.
    async logout(token: string | undefined): Promise<void> {
      if (!token) {
        return;
      }

      await deps.repo.revokeSessionByTokenHash(
        hashSessionToken(token),
        now(),
        "user_logout",
      );
    },
  };
}

export type LogoutService = ReturnType<typeof createLogoutService>;
