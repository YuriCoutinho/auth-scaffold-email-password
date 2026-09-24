import type { FastifyBaseLogger } from "fastify";
import type { SessionRepository } from "./repository.js";

export interface LogoutAllInput {
  userId: string;
  currentSessionId: string;
}

export interface LogoutAllResult {
  revokedCount: number;
}

interface LogoutAllServiceDeps {
  repo: Pick<SessionRepository, "deleteUserSessions">;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
}

export function createLogoutAllService(deps: LogoutAllServiceDeps) {
  return {
    async logoutAll(input: LogoutAllInput): Promise<LogoutAllResult> {
      const { deletedCount } = await deps.repo.deleteUserSessions({
        userId: input.userId,
        exceptSessionId: input.currentSessionId,
      });

      // Signing every device out is what someone does when they suspect their
      // account was reached by someone else, so the event is worth a line even
      // though the request itself succeeded.
      deps.log?.info(
        { userId: input.userId, revokedCount: deletedCount },
        "all sessions revoked",
      );

      return { revokedCount: deletedCount };
    },
  };
}

export type LogoutAllService = ReturnType<typeof createLogoutAllService>;
