import { generateId } from "../../lib/id.js";
import { generateToken } from "../../lib/token.js";
import { hashSessionToken } from "../../lib/token-hash.js";
import { expiresAt, hasExpired, type TtlPolicy } from "../../lib/ttl.js";
import type { SessionsRepository } from "./repository.js";

export type AuthenticateResult =
  | { outcome: "authenticated"; user: { id: string }; session: { id: string } }
  | { outcome: "invalid" };

export interface SessionSummary {
  id: string;
  deviceLabel: string | null;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

export interface SessionsServiceDeps {
  repo: SessionsRepository;
  ttl: TtlPolicy;
  now?: () => Date;
}

export function createSessionsService(deps: SessionsServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    // One place builds a session, so login, signup confirmation and password
    // reset cannot drift on id, hashing or expiry.
    async issue(input: {
      userId: string;
      deviceLabel: string | null;
    }): Promise<string> {
      const token = generateToken();
      const createdAt = now();
      await deps.repo.createSession({
        id: generateId(),
        userId: input.userId,
        tokenHash: hashSessionToken(token),
        deviceLabel: input.deviceLabel,
        createdAt,
        expiresAt: expiresAt(createdAt, deps.ttl.sessionSeconds),
      });
      return token;
    },

    async authenticate(token: string | undefined): Promise<AuthenticateResult> {
      if (!token) {
        return { outcome: "invalid" };
      }

      const session = await deps.repo.findSessionByTokenHash(
        hashSessionToken(token),
      );

      if (!session || hasExpired(session.expiresAt, now())) {
        return { outcome: "invalid" };
      }

      return {
        outcome: "authenticated",
        user: { id: session.userId },
        session: { id: session.id },
      };
    },

    // Resolves the same way whether a session was deleted or not: the caller
    // answers 204 either way, and telling it apart would leak whether that
    // cookie named a real session.
    async endByToken(token: string | undefined): Promise<void> {
      if (!token) {
        return;
      }

      await deps.repo.deleteSessionByTokenHash(hashSessionToken(token));
    },

    async endAllOfUser(input: {
      userId: string;
      exceptSessionId?: string;
    }): Promise<number> {
      const { deletedCount } = await deps.repo.deleteUserSessions(input);
      return deletedCount;
    },

    async endOne(input: {
      userId: string;
      sessionId: string;
    }): Promise<boolean> {
      const { deleted } = await deps.repo.deleteUserSession({
        id: input.sessionId,
        userId: input.userId,
      });
      return deleted;
    },

    async listActive(input: {
      userId: string;
      currentSessionId: string;
    }): Promise<SessionSummary[]> {
      const records = await deps.repo.listUserSessions({
        userId: input.userId,
        activeAt: now(),
      });

      return records.map((record) => ({
        id: record.id,
        deviceLabel: record.deviceLabel,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        isCurrent: record.id === input.currentSessionId,
      }));
    },

    async purgeExpired(at: Date): Promise<number> {
      return deps.repo.purgeExpired(at);
    },
  };
}

export type SessionsService = ReturnType<typeof createSessionsService>;
