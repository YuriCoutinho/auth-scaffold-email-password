import type { FastifyBaseLogger } from "fastify";
import type { SessionRepository } from "./repository.js";

export interface LogoutAllInput {
  userId: number;
  currentSessionId: number;
}

export interface LogoutAllResult {
  revokedCount: number;
}

interface LogoutAllServiceDeps {
  repo: Pick<SessionRepository, "revokeAllUserSessions">;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createLogoutAllService(deps: LogoutAllServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async logoutAll(input: LogoutAllInput): Promise<LogoutAllResult> {
      const { revokedCount } = await deps.repo.revokeAllUserSessions({
        userId: input.userId,
        revokedAt: now(),
        revokedReason: "logout_all",
        exceptSessionId: input.currentSessionId,
      });

      // Signing every device out is what someone does when they suspect their
      // account was reached by someone else, so the event is worth a line even
      // though the request itself succeeded.
      deps.log?.info(
        { userId: input.userId, revokedCount },
        "all sessions revoked",
      );

      return { revokedCount };
    },
  };
}

export type LogoutAllService = ReturnType<typeof createLogoutAllService>;
