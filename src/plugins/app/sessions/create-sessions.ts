import type { FastifyBaseLogger } from "fastify";
import { createListSessionsService } from "./list-sessions.js";
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
  const { listSessions } = createListSessionsService({
    ...shared,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const { revokeSession } = createRevokeSessionService(shared);

  return { listSessions, revokeSession };
}

export type Sessions = ReturnType<typeof createSessions>;
