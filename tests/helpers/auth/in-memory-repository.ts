import { randomUUID } from "node:crypto";
import type { RevokedReason } from "../../../src/lib/session.js";
import type {
  AuthRepository,
  AuthUserRecord,
  ChangeUserPasswordInput,
  PendingSignupRecord,
  PendingSignupResendState,
  PromotePendingSignupInput,
  UpsertPendingSignupInput,
} from "../../../src/plugins/app/auth/repository.js";
import type { OutboxMessage } from "../../../src/plugins/app/email-outbox/repository.js";
import type {
  SessionRecord,
  SessionRepository,
} from "../../../src/plugins/app/sessions/repository.js";
import {
  createInMemoryEmailOutboxRepository,
  type InMemoryEmailOutboxRepository,
} from "../email-outbox/in-memory-repository.js";

export interface InMemorySeed {
  // Shared with the outbox plugin in the app options, so a test sees the row
  // the repository queued no matter which side it asserts on.
  emailOutbox?: InMemoryEmailOutboxRepository;
  authUsers?: Array<{
    email: string;
    id?: number;
    publicId?: string;
    passwordHash?: string;
  }>;
  pendingSignups?: Array<
    Partial<PendingSignupRecord> & { email: string; expiresAt: Date }
  >;
  sessions?: Array<{
    userId: number;
    tokenHash: string;
    expiresAt: Date;
    id?: number;
    publicId?: string;
    createdAt?: Date;
    deviceLabel?: string | null;
    revokedAt?: Date | null;
  }>;
}

interface StoredAuthUser extends AuthUserRecord {
  email: string;
}

interface StoredSession extends SessionRecord {
  publicId: string;
  tokenHash: string;
  deviceLabel: string | null;
  createdAt: Date;
  revokedReason: RevokedReason | null;
}

export function createInMemoryAuthRepository(seed: InMemorySeed = {}) {
  const outbox = seed.emailOutbox ?? createInMemoryEmailOutboxRepository();
  const authUsers = new Map<string, StoredAuthUser>();
  const pendingSignups = new Map<string, PendingSignupRecord>();
  const sessions: StoredSession[] = [];
  const profiles: Array<{ userId: number }> = [];
  let nextUserId = 1;
  let nextPendingId = 1;
  let nextSessionId = 1;

  for (const user of seed.authUsers ?? []) {
    const id = user.id ?? nextUserId;
    nextUserId = Math.max(nextUserId, id + 1);
    authUsers.set(user.email, {
      id,
      email: user.email,
      publicId: user.publicId ?? randomUUID(),
      passwordHash: user.passwordHash ?? "seeded-hash",
    });
  }

  for (const pending of seed.pendingSignups ?? []) {
    const id = pending.id ?? nextPendingId;
    nextPendingId = Math.max(nextPendingId, id + 1);
    pendingSignups.set(pending.email, {
      id,
      email: pending.email,
      passwordHash: pending.passwordHash ?? "seeded-hash",
      codeHash: pending.codeHash ?? "seeded-code-hash",
      signupSessionToken: pending.signupSessionToken ?? `token-${id}`,
      codeAttempts: pending.codeAttempts ?? 0,
      lastSentAt: pending.lastSentAt ?? new Date(),
      codeSendCount: pending.codeSendCount ?? 1,
      expiresAt: pending.expiresAt,
    });
  }

  for (const session of seed.sessions ?? []) {
    const id = session.id ?? nextSessionId;
    nextSessionId = Math.max(nextSessionId, id + 1);
    sessions.push({
      id,
      publicId: session.publicId ?? randomUUID(),
      userId: session.userId,
      tokenHash: session.tokenHash,
      deviceLabel: session.deviceLabel ?? null,
      createdAt: session.createdAt ?? new Date(),
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt ?? null,
      revokedReason: null,
    });
  }

  const findByToken = (token: string) =>
    [...pendingSignups.values()].find((p) => p.signupSessionToken === token);

  const repository: AuthRepository & SessionRepository = {
    async findAuthUserByEmail(email) {
      const user = authUsers.get(email);
      return user
        ? {
            id: user.id,
            publicId: user.publicId,
            passwordHash: user.passwordHash,
          }
        : undefined;
    },

    async findPendingSignupByEmail(email) {
      return pendingSignups.get(email);
    },

    async upsertPendingSignupAndQueueEmail(
      input: UpsertPendingSignupInput & { message: OutboxMessage },
    ) {
      const existing = pendingSignups.get(input.email);
      const id = existing?.id ?? nextPendingId++;
      pendingSignups.set(input.email, {
        id,
        email: input.email,
        passwordHash: input.passwordHash,
        codeHash: input.codeHash,
        signupSessionToken: input.signupSessionToken,
        expiresAt: input.expiresAt,
        codeAttempts: 0,
        lastSentAt: input.now,
        codeSendCount: 1,
      });
      await outbox.enqueue(input.message);
      return { id };
    },

    async markPendingSignupUndelivered(email) {
      const pending = pendingSignups.get(email);
      if (pending) {
        pending.codeSendCount = 0;
      }
    },

    async findPendingSignupBySessionToken(token) {
      return findByToken(token);
    },

    async updatePendingSignupResendStateAndQueueEmail(
      token,
      state: PendingSignupResendState,
      message: OutboxMessage,
    ) {
      const pending = findByToken(token);
      if (pending) {
        Object.assign(pending, state);
      }
      await outbox.enqueue(message);
    },

    async incrementCodeAttempts(token) {
      const pending = findByToken(token);
      if (pending) {
        pending.codeAttempts += 1;
      }
    },

    async promotePendingSignup(input: PromotePendingSignupInput) {
      const user: StoredAuthUser = {
        id: nextUserId++,
        email: input.email,
        publicId: randomUUID(),
        passwordHash: input.passwordHash,
      };
      authUsers.set(input.email, user);
      const pending = findByToken(input.signupSessionToken);
      if (pending) {
        pendingSignups.delete(pending.email);
      }
      sessions.push({
        id: nextSessionId++,
        publicId: randomUUID(),
        userId: user.id,
        tokenHash: input.sessionTokenHash,
        deviceLabel: input.deviceLabel,
        createdAt: new Date(),
        expiresAt: input.sessionExpiresAt,
        revokedAt: null,
        revokedReason: null,
      });
      profiles.push({ userId: user.id });
      return { id: user.id, publicId: user.publicId };
    },

    async createSession(input) {
      sessions.push({
        ...input,
        id: nextSessionId++,
        publicId: randomUUID(),
        createdAt: new Date(),
        revokedAt: null,
        revokedReason: null,
      });
    },

    async findSessionByTokenHash(tokenHash) {
      const session = sessions.find((s) => s.tokenHash === tokenHash);
      return session
        ? {
            id: session.id,
            userId: session.userId,
            expiresAt: session.expiresAt,
            revokedAt: session.revokedAt,
          }
        : undefined;
    },

    async findAuthUserById(id) {
      const user = [...authUsers.values()].find((u) => u.id === id);
      return user ? { publicId: user.publicId, email: user.email } : undefined;
    },

    async findAuthUserCredentialsById(id) {
      const user = [...authUsers.values()].find((u) => u.id === id);
      return user
        ? { id: user.id, email: user.email, passwordHash: user.passwordHash }
        : undefined;
    },

    async changeUserPassword(input: ChangeUserPasswordInput) {
      for (const session of sessions) {
        if (
          session.userId === input.userId &&
          session.id !== input.exceptSessionId &&
          session.revokedAt === null
        ) {
          session.revokedAt = input.revokedAt;
          session.revokedReason = input.revokedReason;
        }
      }

      const user = [...authUsers.values()].find((u) => u.id === input.userId);
      if (user) {
        user.passwordHash = input.passwordHash;
      }

      await outbox.enqueue(input.message);
    },

    async revokeSessionByTokenHash(tokenHash, revokedAt, revokedReason) {
      const session = sessions.find(
        (s) => s.tokenHash === tokenHash && s.revokedAt === null,
      );
      if (session) {
        session.revokedAt = revokedAt;
        session.revokedReason = revokedReason;
      }
    },

    async revokeAllUserSessions(input) {
      const targets = sessions.filter(
        (s) =>
          s.userId === input.userId &&
          s.revokedAt === null &&
          s.id !== input.exceptSessionId,
      );

      for (const session of targets) {
        session.revokedAt = input.revokedAt;
        session.revokedReason = input.revokedReason;
      }

      return { revokedCount: targets.length };
    },

    async revokeUserSessionByPublicId(input) {
      const session = sessions.find(
        (s) =>
          s.publicId === input.publicId &&
          s.userId === input.userId &&
          s.revokedAt === null &&
          s.expiresAt.getTime() > input.now.getTime(),
      );

      if (!session) {
        return { revoked: false };
      }

      session.revokedAt = input.revokedAt;
      session.revokedReason = input.revokedReason;
      return { revoked: true };
    },

    async listActiveUserSessions(input) {
      return sessions
        .filter(
          (session) =>
            session.userId === input.userId &&
            session.revokedAt === null &&
            session.expiresAt.getTime() > input.now.getTime(),
        )
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id,
        )
        .map((session) => ({
          id: session.id,
          publicId: session.publicId,
          deviceLabel: session.deviceLabel,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        }));
    },
  };

  return {
    ...repository,
    authUsers,
    pendingSignups,
    sessions,
    profiles,
    outbox,
  };
}

export type InMemoryAuthRepository = ReturnType<
  typeof createInMemoryAuthRepository
>;
