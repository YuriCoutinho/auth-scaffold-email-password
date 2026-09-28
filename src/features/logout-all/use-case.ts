import type { FastifyBaseLogger } from "fastify";
import type { SessionsService } from "../../modules/sessions/service.js";

interface LogoutAllDeps {
  sessions: Pick<SessionsService, "endAllOfUser">;
  log?: Pick<FastifyBaseLogger, "info">;
}

export function createLogoutAll(deps: LogoutAllDeps) {
  return async (input: { userId: string; currentSessionId: string }) => {
    const revokedCount = await deps.sessions.endAllOfUser({
      userId: input.userId,
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
  };
}
