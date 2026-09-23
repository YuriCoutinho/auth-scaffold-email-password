import type { FastifyBaseLogger } from "fastify";
import type { SessionRepository } from "./repository.js";

export interface LogoutAllInput {
  userId: number;
  currentSessionId: number;
  includeCurrentSession: boolean;
}

export interface LogoutAllResult {
  revokedCount: number;
  currentSessionRevoked: boolean;
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
        ...(input.includeCurrentSession
          ? {}
          : { exceptSessionId: input.currentSessionId }),
      });

      // Signing every device out is what someone does when they suspect their
      // account was reached by someone else, so the event is worth a line even
      // though the request itself succeeded.
      deps.log?.info(
        {
          userId: input.userId,
          revokedCount,
          includeCurrentSession: input.includeCurrentSession,
        },
        "all sessions revoked",
      );

      // Mirrors the input today, and stays here on purpose: whether the caller
      // still holds a usable cookie is one rule with one owner, instead of
      // being decided again by the route.
      return {
        revokedCount,
        currentSessionRevoked: input.includeCurrentSession,
      };
    },
  };
}

export type LogoutAllService = ReturnType<typeof createLogoutAllService>;
