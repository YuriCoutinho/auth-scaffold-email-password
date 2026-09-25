import { randomUUID } from "node:crypto";
import type { RepositoryFactories } from "../../src/app-options.js";
import type { Transaction } from "../../src/db/client.js";
import { DEFAULT_TTL, expiresAt as expiryFrom } from "../../src/lib/ttl.js";
import type {
  CredentialThrottleRepository,
  ThrottleRecord,
} from "../../src/modules/credential-throttle/repository.js";
import type {
  OtpRepository,
  SaveVerificationCodeInput,
  VerificationCodeKey,
  VerificationPurpose,
} from "../../src/modules/otp/repository.js";
import type {
  CreateSessionInput,
  SessionsRepository,
} from "../../src/modules/sessions/repository.js";
import type {
  UserRecord,
  UsersRepository,
} from "../../src/modules/users/repository.js";
import {
  Rollback,
  type TransactionRunner,
} from "../../src/plugins/transaction.js";

export interface InMemorySeed {
  users?: Array<{
    email: string;
    id?: string;
    passwordHash?: string;
    emailVerifiedAt?: Date | null;
  }>;
  verificationCodes?: Array<
    Partial<SaveVerificationCodeInput> & {
      userId: string;
      purpose: VerificationPurpose;
      issuedAt: Date;
    }
  >;
  sessions?: Array<
    Partial<CreateSessionInput> & { userId: string; tokenHash: string }
  >;
}

export interface InMemoryStore {
  users: Map<string, UserRecord>;
  verificationCodes: Map<string, SaveVerificationCodeInput>;
  sessions: Map<string, CreateSessionInput>;
  throttle: Map<string, ThrottleRecord>;
  repositories: RepositoryFactories;
  transaction: TransactionRunner;
}

const codeKey = (key: VerificationCodeKey) => `${key.userId}:${key.purpose}`;

export function createInMemoryStore(seed: InMemorySeed = {}): InMemoryStore {
  const users = new Map<string, UserRecord>();
  const verificationCodes = new Map<string, SaveVerificationCodeInput>();
  const sessions = new Map<string, CreateSessionInput>();
  const throttle = new Map<string, ThrottleRecord>();

  for (const user of seed.users ?? []) {
    const id = user.id ?? randomUUID();
    users.set(id, {
      id,
      email: user.email,
      passwordHash: user.passwordHash ?? "seeded-hash",
      // Seeded accounts are confirmed unless a test says otherwise, because
      // that is what almost every flow needs to start from.
      emailVerifiedAt:
        user.emailVerifiedAt === undefined ? new Date(0) : user.emailVerifiedAt,
    });
  }

  for (const code of seed.verificationCodes ?? []) {
    verificationCodes.set(codeKey(code), {
      userId: code.userId,
      purpose: code.purpose,
      tokenHash: code.tokenHash ?? `token-hash-${code.userId}-${code.purpose}`,
      codeHash: code.codeHash ?? "seeded-code-hash",
      codeAttempts: code.codeAttempts ?? 0,
      codeSendCount: code.codeSendCount ?? 1,
      issuedAt: code.issuedAt,
      // Seeds that only care about age get the expiry a default issue gives.
      expiresAt:
        code.expiresAt ??
        expiryFrom(
          code.issuedAt,
          code.purpose === "signup"
            ? DEFAULT_TTL.signupCodeSeconds
            : DEFAULT_TTL.passwordResetCodeSeconds,
        ),
    });
  }

  for (const session of seed.sessions ?? []) {
    const id = session.id ?? randomUUID();
    const createdAt = session.createdAt ?? new Date();
    sessions.set(id, {
      id,
      userId: session.userId,
      tokenHash: session.tokenHash,
      deviceLabel: session.deviceLabel ?? null,
      createdAt,
      // Seeds that only care about age get the expiry a default issue gives.
      expiresAt:
        session.expiresAt ?? expiryFrom(createdAt, DEFAULT_TTL.sessionSeconds),
    });
  }

  const findUserByEmail = (email: string) =>
    [...users.values()].find((user) => user.email === email);

  // Reads hand out a copy, like a real query does. Returning the stored object
  // would let a caller see its own later writes through the value it read.
  const toUserRecord = (user: UserRecord | undefined): UserRecord | undefined =>
    user && {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      emailVerifiedAt: user.emailVerifiedAt,
    };

  const withOwner = (code: SaveVerificationCodeInput | undefined) => {
    const owner = code && users.get(code.userId);
    return code && owner
      ? { ...code, email: owner.email, passwordHash: owner.passwordHash }
      : undefined;
  };

  const sessionsRepository: SessionsRepository = {
    async createSession(input) {
      sessions.set(input.id, { ...input });
    },

    async findSessionByTokenHash(tokenHash) {
      const session = [...sessions.values()].find(
        (candidate) => candidate.tokenHash === tokenHash,
      );
      return (
        session && {
          id: session.id,
          userId: session.userId,
          expiresAt: session.expiresAt,
        }
      );
    },

    async deleteSessionByTokenHash(tokenHash) {
      for (const [id, session] of sessions) {
        if (session.tokenHash === tokenHash) {
          sessions.delete(id);
        }
      }
    },

    async deleteUserSessions(input) {
      let deletedCount = 0;
      for (const [id, session] of sessions) {
        if (session.userId === input.userId && id !== input.exceptSessionId) {
          sessions.delete(id);
          deletedCount++;
        }
      }
      return { deletedCount };
    },

    async deleteUserSession(input) {
      const session = sessions.get(input.id);
      if (!session || session.userId !== input.userId) {
        return { deleted: false };
      }
      sessions.delete(input.id);
      return { deleted: true };
    },

    async listUserSessions(input) {
      return [...sessions.values()]
        .filter(
          (session) =>
            session.userId === input.userId &&
            session.expiresAt.getTime() > input.activeAt.getTime(),
        )
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            b.id.localeCompare(a.id),
        )
        .map((session) => ({
          id: session.id,
          deviceLabel: session.deviceLabel,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        }));
    },

    async purgeExpired(at) {
      let purgedCount = 0;
      for (const [id, session] of sessions) {
        if (session.expiresAt.getTime() <= at.getTime()) {
          sessions.delete(id);
          purgedCount++;
        }
      }
      return purgedCount;
    },
  };

  const usersRepository: UsersRepository = {
    async findByEmail(email) {
      return toUserRecord(findUserByEmail(email));
    },

    async findById(id) {
      return toUserRecord(users.get(id));
    },

    async upsertUnverified(input) {
      const existing = findUserByEmail(input.email);
      if (existing?.emailVerifiedAt) {
        return null;
      }
      const userId = existing?.id ?? input.id;
      if (existing) {
        existing.passwordHash = input.passwordHash;
      } else {
        users.set(userId, { ...input, emailVerifiedAt: null });
      }
      return { userId };
    },

    async markVerified(id, at) {
      const user = users.get(id);
      if (!user || user.emailVerifiedAt) {
        return false;
      }
      user.emailVerifiedAt = at;
      return true;
    },

    async setPasswordHash(id, passwordHash) {
      const user = users.get(id);
      if (user) {
        user.passwordHash = passwordHash;
      }
    },

    async purgeAbandonedUnverified() {
      const codeOwners = new Set(
        [...verificationCodes.values()].map((code) => code.userId),
      );
      let purgedCount = 0;
      for (const [id, user] of users) {
        if (!user.emailVerifiedAt && !codeOwners.has(id)) {
          users.delete(id);
          purgedCount++;
        }
      }
      return purgedCount;
    },
  };

  // Codes are read joined to their owner, like the Drizzle reads.
  const otpRepository: OtpRepository = {
    async find(key) {
      return withOwner(verificationCodes.get(codeKey(key)));
    },

    async findByTokenHash(purpose, tokenHash) {
      return withOwner(
        [...verificationCodes.values()].find(
          (code) => code.purpose === purpose && code.tokenHash === tokenHash,
        ),
      );
    },

    async save(input) {
      verificationCodes.set(codeKey(input), { ...input });
    },

    async rotateToken(key, tokenHash) {
      const code = verificationCodes.get(codeKey(key));
      if (code) {
        code.tokenHash = tokenHash;
      }
    },

    async restore(key, failedCodeHash, previous) {
      const code = verificationCodes.get(codeKey(key));
      if (code && code.codeHash === failedCodeHash) {
        Object.assign(code, previous);
      }
    },

    async incrementAttempts(key) {
      const code = verificationCodes.get(codeKey(key));
      if (code) {
        code.codeAttempts++;
      }
    },

    async consume(purpose, input) {
      const key = codeKey({ userId: input.userId, purpose });
      const code = verificationCodes.get(key);
      if (
        !code ||
        code.tokenHash !== input.tokenHash ||
        code.codeHash !== input.codeHash
      ) {
        return false;
      }
      verificationCodes.delete(key);
      return true;
    },

    async purgeExpired(at) {
      let purgedCount = 0;
      for (const [key, code] of verificationCodes) {
        if (code.expiresAt.getTime() <= at.getTime()) {
          verificationCodes.delete(key);
          purgedCount++;
        }
      }
      return purgedCount;
    },
  };

  // Backed by the `store.throttle` map, so a test can seed or read the trail
  // directly.
  const credentialThrottleRepository: CredentialThrottleRepository = {
    async findThrottleByKeyHash(keyHash) {
      return throttle.get(keyHash);
    },

    async upsertThrottleFailure(input) {
      throttle.set(input.keyHash, {
        failedCount: input.failedCount,
        lastFailedAt: input.lastFailedAt,
      });
    },

    async clearThrottle(keyHash) {
      throttle.delete(keyHash);
    },

    async purgeStale(before) {
      let purgedCount = 0;
      for (const [keyHash, record] of throttle) {
        if (record.lastFailedAt.getTime() < before.getTime()) {
          throttle.delete(keyHash);
          purgedCount++;
        }
      }
      return purgedCount;
    },
  };

  const repositories: RepositoryFactories = {
    users: () => usersRepository,
    sessions: () => sessionsRepository,
    otp: () => otpRepository,
    credentialThrottle: () => credentialThrottleRepository,
  };

  const cloneState = () => ({
    users: new Map(
      [...users].map(([id, value]) => [id, structuredClone(value)]),
    ),
    verificationCodes: new Map(
      [...verificationCodes].map(([id, value]) => [id, structuredClone(value)]),
    ),
    sessions: new Map(
      [...sessions].map(([id, value]) => [id, structuredClone(value)]),
    ),
    throttle: new Map(
      [...throttle].map(([id, value]) => [id, structuredClone(value)]),
    ),
  });

  // Restores into the SAME map instances: tests hold onto `store.users` and
  // the other maps by reference, so replacing them would strand those tests
  // watching a map the store no longer writes to.
  const restoreState = (snapshot: ReturnType<typeof cloneState>) => {
    users.clear();
    for (const [id, value] of snapshot.users) {
      users.set(id, value);
    }
    verificationCodes.clear();
    for (const [id, value] of snapshot.verificationCodes) {
      verificationCodes.set(id, value);
    }
    sessions.clear();
    for (const [id, value] of snapshot.sessions) {
      sessions.set(id, value);
    }
    throttle.clear();
    for (const [id, value] of snapshot.throttle) {
      throttle.set(id, value);
    }
  };

  const transaction: TransactionRunner = async (work) => {
    const snapshot = cloneState();
    try {
      // The store's repository factories ignore the executor they are handed, so
      // any value satisfying the type stands in for an open transaction.
      return await work({} as Transaction);
    } catch (error) {
      restoreState(snapshot);
      if (error instanceof Rollback) {
        return error.value;
      }
      throw error;
    }
  };

  return {
    users,
    verificationCodes,
    sessions,
    throttle,
    repositories,
    transaction,
  };
}
