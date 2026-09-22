import { randomUUID } from "node:crypto";
import type {
  AuthRepository,
  AuthUserRecord,
  CreateSessionInput,
  PendingSignupRecord,
  PendingSignupResendState,
  PromotePendingSignupInput,
  UpsertPendingSignupInput,
} from "../../src/plugins/app/auth/auth-repository.js";

export interface InMemorySeed {
  authUsers?: Array<{
    email: string;
    id?: number;
    publicId?: string;
    passwordHash?: string;
  }>;
  pendingSignups?: Array<
    Partial<PendingSignupRecord> & { email: string; expiresAt: Date }
  >;
}

interface StoredAuthUser extends AuthUserRecord {
  email: string;
}

export function createInMemoryAuthRepository(seed: InMemorySeed = {}) {
  const authUsers = new Map<string, StoredAuthUser>();
  const pendingSignups = new Map<string, PendingSignupRecord>();
  const sessions: CreateSessionInput[] = [];
  const profiles: Array<{ userId: number }> = [];
  let nextUserId = 1;
  let nextPendingId = 1;

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

  const findByToken = (token: string) =>
    [...pendingSignups.values()].find((p) => p.signupSessionToken === token);

  const repository: AuthRepository = {
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

    async upsertPendingSignup(input: UpsertPendingSignupInput) {
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
      return { id };
    },

    async resetPendingSignupSendState(email) {
      const pending = pendingSignups.get(email);
      if (pending) {
        pending.codeSendCount = 0;
      }
    },

    async findPendingSignupBySessionToken(token) {
      return findByToken(token);
    },

    async updatePendingSignupResendState(
      token,
      state: PendingSignupResendState,
    ) {
      const pending = findByToken(token);
      if (pending) {
        Object.assign(pending, state);
      }
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
        userId: user.id,
        tokenHash: input.sessionTokenHash,
        deviceLabel: input.deviceLabel,
        expiresAt: input.sessionExpiresAt,
      });
      profiles.push({ userId: user.id });
      return { id: user.id, publicId: user.publicId };
    },

    async createSession(input) {
      sessions.push({ ...input });
    },
  };

  return { ...repository, authUsers, pendingSignups, sessions, profiles };
}

export type InMemoryAuthRepository = ReturnType<
  typeof createInMemoryAuthRepository
>;
