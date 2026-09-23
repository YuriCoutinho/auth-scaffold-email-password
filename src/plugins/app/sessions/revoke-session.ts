import type { FastifyBaseLogger } from "fastify";
import type { SessionRepository } from "./repository.js";

export interface RevokeSessionInput {
  userId: number;
  publicId: string;
}

interface RevokeSessionServiceDeps {
  repo: Pick<SessionRepository, "revokeUserSessionByPublicId">;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createRevokeSessionService(deps: RevokeSessionServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    // Resolves the same way whether a session was revoked or not: the caller
    // answers 204 either way, and telling it apart would leak whether that id
    // named a session of this user.
    async revokeSession(input: RevokeSessionInput): Promise<void> {
      const at = now();
      const { revoked } = await deps.repo.revokeUserSessionByPublicId({
        publicId: input.publicId,
        userId: input.userId,
        revokedAt: at,
        revokedReason: "session_revoked",
        now: at,
      });

      // The response is deliberately generic, so the detail of which session
      // died lives here, where it never reaches the client. Nothing revoked is
      // not an event, so it writes no line.
      if (revoked) {
        deps.log?.info(
          { userId: input.userId, sessionPublicId: input.publicId },
          "session revoked",
        );
      }
    },
  };
}

export type RevokeSessionService = ReturnType<
  typeof createRevokeSessionService
>;
