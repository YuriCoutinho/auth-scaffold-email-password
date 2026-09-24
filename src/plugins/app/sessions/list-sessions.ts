import { expiresAt, issuedAfter } from "../../../lib/ttl.js";
import type { SessionRepository } from "./repository.js";

export interface ListSessionsInput {
  userId: string;
  currentSessionId: string;
}

export interface SessionSummary {
  id: string;
  deviceLabel: string | null;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

interface ListSessionsServiceDeps {
  repo: Pick<SessionRepository, "listUserSessions">;
  sessionTtlSeconds: number;
  now?: () => Date;
}

export function createListSessionsService(deps: ListSessionsServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async listSessions(input: ListSessionsInput): Promise<SessionSummary[]> {
      const records = await deps.repo.listUserSessions({
        userId: input.userId,
        createdAfter: issuedAfter(deps.sessionTtlSeconds, now()),
      });

      return records.map((record) => ({
        id: record.id,
        deviceLabel: record.deviceLabel,
        createdAt: record.createdAt,
        expiresAt: expiresAt(record.createdAt, deps.sessionTtlSeconds),
        isCurrent: record.id === input.currentSessionId,
      }));
    },
  };
}

export type ListSessionsService = ReturnType<typeof createListSessionsService>;
