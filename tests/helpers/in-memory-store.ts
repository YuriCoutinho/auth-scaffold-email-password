import { randomUUID } from "node:crypto";
import type { Transaction } from "../../src/db/client.js";
import { DEFAULT_TTL, expiresAt as expiryFrom } from "../../src/lib/ttl.js";
import type {
  AuthRepository,
  ConsumeVerificationCodeInput,
  SaveVerificationCodeInput,
  UserRecord,
  VerificationCodeKey,
  VerificationPurpose,
} from "../../src/plugins/app/auth/repository.js";
import type {
  CredentialThrottleRepository,
  ThrottleRecord,
} from "../../src/plugins/app/credential-throttle/repository.js";
import type {
  CreateSessionInput,
  SessionRepository,
} from "../../src/plugins/app/sessions/repository.js";
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

// No module has its own repository factory yet: each of tasks 4, 7, 8 and 9
// adds one entry here as it migrates off the legacy ports.
type RepositoryFactories = Record<string, never>;

export interface InMemoryStore {
  users: Map<string, UserRecord>;
  verificationCodes: Map<string, SaveVerificationCodeInput>;
  sessions: Map<string, CreateSessionInput>;
  throttle: Map<string, ThrottleRecord>;
  repositories: RepositoryFactories;
  transaction: TransactionRunner;
  // Every port a service or route still asks for by name, until task 15
  // finishes moving them to `repositories`.
  legacy: AuthRepository & SessionRepository & CredentialThrottleRepository;
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

  const consumeCode = (
    purpose: VerificationPurpose,
    input: ConsumeVerificationCodeInput,
  ) => {
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
  };

  const deleteUserSessions = (userId: string, exceptSessionId?: string) => {
    let deletedCount = 0;
    for (const [id, session] of sessions) {
      if (session.userId === userId && id !== exceptSessionId) {
        sessions.delete(id);
        deletedCount++;
      }
    }
    return deletedCount;
  };

  const legacy: AuthRepository &
    SessionRepository &
    CredentialThrottleRepository = {
    async findUserByEmail(email) {
      return toUserRecord(findUserByEmail(email));
    },

    async findUserById(id) {
      return toUserRecord(users.get(id));
    },

    async startSignup(user, code) {
      const existing = findUserByEmail(user.email);
      if (existing?.emailVerifiedAt) {
        return null;
      }
      const userId = existing?.id ?? user.id;
      if (existing) {
        existing.passwordHash = user.passwordHash;
      } else {
        users.set(userId, { ...user, emailVerifiedAt: null });
      }
      verificationCodes.set(codeKey({ userId, purpose: "signup" }), {
        userId,
        purpose: "signup",
        ...code,
      });
      return { userId };
    },

    async findVerificationCode(key) {
      return withOwner(verificationCodes.get(codeKey(key)));
    },

    async findVerificationCodeByTokenHash(purpose, tokenHash) {
      return withOwner(
        [...verificationCodes.values()].find(
          (code) => code.purpose === purpose && code.tokenHash === tokenHash,
        ),
      );
    },

    async saveVerificationCode(input) {
      verificationCodes.set(codeKey(input), { ...input });
    },

    async rotateVerificationToken(key, tokenHash) {
      const code = verificationCodes.get(codeKey(key));
      if (code) {
        code.tokenHash = tokenHash;
      }
    },

    async restoreVerificationCode(key, failedCodeHash, previous) {
      const code = verificationCodes.get(codeKey(key));
      if (code && code.codeHash === failedCodeHash) {
        Object.assign(code, previous);
      }
    },

    async incrementVerificationAttempts(key) {
      const code = verificationCodes.get(codeKey(key));
      if (code) {
        code.codeAttempts++;
      }
    },

    async verifyEmail(input) {
      const user = users.get(input.userId);
      if (!user || user.emailVerifiedAt) {
        return false;
      }
      if (!consumeCode("signup", input)) {
        return false;
      }
      user.emailVerifiedAt = input.verifiedAt;
      sessions.set(input.session.id, {
        ...input.session,
        userId: input.userId,
      });
      return true;
    },

    async changePassword(input) {
      deleteUserSessions(input.userId, input.exceptSessionId);
      const user = users.get(input.userId);
      if (user) {
        user.passwordHash = input.passwordHash;
      }
    },

    async resetPassword(input) {
      if (!consumeCode("password_reset", input)) {
        return false;
      }
      deleteUserSessions(input.userId);
      const user = users.get(input.userId);
      if (user) {
        user.passwordHash = input.passwordHash;
      }
      sessions.set(input.session.id, {
        ...input.session,
        userId: input.userId,
      });
      return true;
    },

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
      return {
        deletedCount: deleteUserSessions(input.userId, input.exceptSessionId),
      };
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
    repositories: {},
    transaction,
    legacy,
  };
}
