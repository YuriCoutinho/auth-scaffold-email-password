import type { SessionRepository } from "../sessions/repository.js";

export interface ListSessionsInput {
  userId: number;
  currentSessionId: number;
}

export interface SessionSummary {
  id: string;
  deviceLabel: string | null;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

interface ListSessionsServiceDeps {
  repo: Pick<SessionRepository, "listActiveUserSessions">;
  now?: () => Date;
}

export function createListSessionsService(deps: ListSessionsServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async listSessions(input: ListSessionsInput): Promise<SessionSummary[]> {
      const records = await deps.repo.listActiveUserSessions({
        userId: input.userId,
        now: now(),
      });

      // The internal id is compared here and dropped here: which session the
      // request is coming from is one rule with one owner, and the serial id
      // never reaches a payload.
      return records.map((record) => ({
        id: record.publicId,
        deviceLabel: record.deviceLabel,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        isCurrent: record.id === input.currentSessionId,
      }));
    },
  };
}

export type ListSessionsService = ReturnType<typeof createListSessionsService>;
