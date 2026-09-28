import type { SessionsService } from "../../modules/sessions/service.js";

interface LogoutDeps {
  sessions: Pick<SessionsService, "endByToken">;
}

export function createLogout(deps: LogoutDeps) {
  return async (token: string | undefined): Promise<void> => {
    await deps.sessions.endByToken(token);
  };
}
