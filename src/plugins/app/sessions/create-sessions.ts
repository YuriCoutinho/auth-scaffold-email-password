import type { FastifyBaseLogger } from "fastify";
import { createListSessionsService } from "./list-sessions.js";
import { createLogoutService } from "./logout.js";
import { createLogoutAllService } from "./logout-all.js";
import type { SessionRepository } from "./repository.js";
import { createRevokeSessionService } from "./revoke-session.js";

export interface SessionsDeps {
  repository: SessionRepository;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createSessions(deps: SessionsDeps) {
  const shared = {
    repo: deps.repository,
    ...(deps.log ? { log: deps.log } : {}),
  };
  const { logout } = createLogoutService(shared);
  const { logoutAll } = createLogoutAllService(shared);
  const { listSessions } = createListSessionsService({
    ...shared,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const { revokeSession } = createRevokeSessionService(shared);

  return { logout, logoutAll, listSessions, revokeSession };
}

export type Sessions = ReturnType<typeof createSessions>;
