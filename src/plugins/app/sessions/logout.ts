import { hashSessionToken } from "../../../lib/token-hash.js";
import type { SessionRepository } from "./repository.js";

interface LogoutServiceDeps {
  repo: Pick<SessionRepository, "deleteSessionByTokenHash">;
}

export function createLogoutService(deps: LogoutServiceDeps) {
  return {
    // Resolves the same way whether a session was deleted or not: the caller
    // answers 204 either way, and telling it apart would leak whether that
    // cookie named a real session.
    async logout(token: string | undefined): Promise<void> {
      if (!token) {
        return;
      }

      await deps.repo.deleteSessionByTokenHash(hashSessionToken(token));
    },
  };
}

export type LogoutService = ReturnType<typeof createLogoutService>;
