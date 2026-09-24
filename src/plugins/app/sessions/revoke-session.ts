import type { FastifyBaseLogger } from "fastify";
import type { SessionRepository } from "./repository.js";

export interface RevokeSessionInput {
  userId: string;
  sessionId: string;
}

interface RevokeSessionServiceDeps {
  repo: Pick<SessionRepository, "deleteUserSession">;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
}

export function createRevokeSessionService(deps: RevokeSessionServiceDeps) {
  return {
    // Resolves the same way whether a session was deleted or not: the caller
    // answers 204 either way, and telling it apart would leak whether that id
    // named a session of this user.
    async revokeSession(input: RevokeSessionInput): Promise<void> {
      const { deleted } = await deps.repo.deleteUserSession({
        id: input.sessionId,
        userId: input.userId,
      });

      // The response is deliberately generic, so the detail of which session
      // died lives here, where it never reaches the client. Nothing deleted is
      // not an event, so it writes no line.
      if (deleted) {
        deps.log?.info(
          { userId: input.userId, sessionId: input.sessionId },
          "session revoked",
        );
      }
    },
  };
}

export type RevokeSessionService = ReturnType<
  typeof createRevokeSessionService
>;
