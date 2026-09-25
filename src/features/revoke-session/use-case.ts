import type { FastifyBaseLogger } from "fastify";
import type { SessionsService } from "../../modules/sessions/service.js";

interface RevokeSessionDeps {
  sessions: Pick<SessionsService, "endOne">;
  log?: Pick<FastifyBaseLogger, "info">;
}

export function createRevokeSession(deps: RevokeSessionDeps) {
  // Resolves the same way whether a session was deleted or not: the caller
  // answers 204 either way, and telling it apart would leak whether that id
  // named a session of this user.
  return async (input: { userId: string; sessionId: string }) => {
    const deleted = await deps.sessions.endOne(input);

    // The response is deliberately generic, so the detail of which session
    // died lives here, where it never reaches the client. Nothing deleted is
    // not an event, so it writes no line.
    if (deleted) {
      deps.log?.info(
        { userId: input.userId, sessionId: input.sessionId },
        "session revoked",
      );
    }
  };
}
