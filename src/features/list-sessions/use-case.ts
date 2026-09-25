import type { SessionsService } from "../../modules/sessions/service.js";

interface ListSessionsDeps {
  sessions: Pick<SessionsService, "listActive">;
}

export function createListSessions(deps: ListSessionsDeps) {
  return async (input: { userId: string; currentSessionId: string }) => {
    return deps.sessions.listActive(input);
  };
}
