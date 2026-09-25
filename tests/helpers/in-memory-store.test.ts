import { describe, expect, it } from "vitest";
import { rollback } from "../../src/plugins/transaction.js";
import { createInMemoryStore } from "./in-memory-store.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const CODE = {
  tokenHash: "token-hash",
  codeHash: "code-hash",
  codeAttempts: 0,
  codeSendCount: 1,
  issuedAt: NOW,
  expiresAt: new Date(NOW.getTime() + 15 * 60 * 1000),
};

function newUser(
  overrides: Partial<{ id: string; passwordHash: string }> = {},
) {
  return {
    id: OWNER,
    email: "user@example.com",
    passwordHash: "hash-1",
    ...overrides,
  };
}

const SESSION_EXPIRES_AT = new Date(NOW.getTime() + 60 * 60 * 1000);

function session(id: string) {
  return {
    id,
    tokenHash: `session-${id}`,
    deviceLabel: null,
    createdAt: NOW,
    expiresAt: SESSION_EXPIRES_AT,
  };
}

function repoWithPendingSignup() {
  return createInMemoryStore({
    users: [{ id: OWNER, email: "user@example.com", emailVerifiedAt: null }],
    verificationCodes: [
      {
        userId: OWNER,
        purpose: "signup",
        tokenHash: "token-hash",
        codeHash: "code-hash",
        issuedAt: NOW,
      },
    ],
  });
}

function repoWithResetCode() {
  return createInMemoryStore({
    users: [
      { id: OWNER, email: "user@example.com", passwordHash: "old-hash" },
      { id: OTHER, email: "other@example.com" },
    ],
    verificationCodes: [
      {
        userId: OWNER,
        purpose: "password_reset",
        tokenHash: "token-hash",
        codeHash: "code-hash",
        issuedAt: NOW,
      },
    ],
    sessions: [
      { id: "s-1", userId: OWNER, tokenHash: "phone", createdAt: NOW },
      { id: "s-2", userId: OTHER, tokenHash: "stranger", createdAt: NOW },
    ],
  });
}

describe("transaction", () => {
  it("restores the snapshot and returns the rollback value when work rolls back", async () => {
    const store = createInMemoryStore({
      users: [
        { id: OWNER, email: "user@example.com", passwordHash: "old-hash" },
      ],
    });

    const result = await store.transaction(async () => {
      const user = store.users.get(OWNER);
      if (user) {
        user.passwordHash = "changed-hash";
      }
      return rollback("x");
    });

    expect(result).toBe("x");
    expect(store.users.get(OWNER)).toMatchObject({ passwordHash: "old-hash" });
  });

  it("restores the snapshot and rethrows when work fails with an ordinary error", async () => {
    const store = createInMemoryStore({
      users: [
        { id: OWNER, email: "user@example.com", passwordHash: "old-hash" },
      ],
    });

    await expect(
      store.transaction(async () => {
        const user = store.users.get(OWNER);
        if (user) {
          user.passwordHash = "changed-hash";
        }
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(store.users.get(OWNER)).toMatchObject({ passwordHash: "old-hash" });
  });

  it("keeps the work's writes when it succeeds", async () => {
    const store = createInMemoryStore({
      users: [
        { id: OWNER, email: "user@example.com", passwordHash: "old-hash" },
      ],
    });

    await store.transaction(async () => {
      const user = store.users.get(OWNER);
      if (user) {
        user.passwordHash = "new-hash";
      }
    });

    expect(store.users.get(OWNER)).toMatchObject({ passwordHash: "new-hash" });
  });
});

describe("legacy.startSignup", () => {
  it("creates an unconfirmed account with its signup code", async () => {
    const { legacy: repo } = createInMemoryStore();

    await expect(repo.startSignup(newUser(), CODE)).resolves.toEqual({
      userId: OWNER,
    });

    expect(await repo.findUserByEmail("user@example.com")).toEqual({
      id: OWNER,
      email: "user@example.com",
      passwordHash: "hash-1",
      emailVerifiedAt: null,
    });
    expect(
      await repo.findVerificationCodeByTokenHash("signup", "token-hash"),
    ).toMatchObject({ userId: OWNER, codeHash: "code-hash" });
  });

  it("refuses a confirmed account and leaves it untouched", async () => {
    const store = createInMemoryStore({
      users: [
        { id: OWNER, email: "user@example.com", passwordHash: "old-hash" },
      ],
    });
    const repo = store.legacy;

    await expect(repo.startSignup(newUser({ id: OTHER }), CODE)).resolves.toBe(
      null,
    );

    expect(await repo.findUserById(OWNER)).toMatchObject({
      passwordHash: "old-hash",
    });
    expect(store.users.size).toBe(1);
    expect(store.verificationCodes.size).toBe(0);
  });

  it("overwrites the password of an unconfirmed account and replaces its token", async () => {
    const store = repoWithPendingSignup();
    const repo = store.legacy;

    await expect(
      repo.startSignup(newUser({ id: OTHER, passwordHash: "hash-2" }), {
        ...CODE,
        tokenHash: "token-hash-2",
      }),
    ).resolves.toEqual({ userId: OWNER });

    expect(await repo.findUserById(OWNER)).toMatchObject({
      passwordHash: "hash-2",
      emailVerifiedAt: null,
    });
    expect(store.users.size).toBe(1);
    expect(
      await repo.findVerificationCodeByTokenHash("signup", "token-hash"),
    ).toBeUndefined();
    expect(
      await repo.findVerificationCodeByTokenHash("signup", "token-hash-2"),
    ).toMatchObject({ userId: OWNER, passwordHash: "hash-2" });
  });
});

describe("legacy.findVerificationCodeByTokenHash", () => {
  it("only matches a code of the given purpose", async () => {
    const { legacy: repo } = repoWithPendingSignup();

    expect(
      await repo.findVerificationCodeByTokenHash(
        "password_reset",
        "token-hash",
      ),
    ).toBeUndefined();
    expect(
      await repo.findVerificationCodeByTokenHash("signup", "token-hash"),
    ).toMatchObject({ email: "user@example.com" });
  });
});

describe("legacy.rotateVerificationToken", () => {
  it("replaces the token and keeps the code", async () => {
    const { legacy: repo } = repoWithPendingSignup();
    const key = { userId: OWNER, purpose: "signup" as const };

    await repo.rotateVerificationToken(key, "rotated");

    expect(await repo.findVerificationCode(key)).toMatchObject({
      tokenHash: "rotated",
      codeHash: "code-hash",
    });
  });
});

describe("legacy.restoreVerificationCode", () => {
  const key = { userId: OWNER, purpose: "signup" as const };
  const previous = {
    codeHash: "previous-code",
    codeAttempts: 2,
    codeSendCount: 3,
    issuedAt: new Date(NOW.getTime() - 60_000),
    expiresAt: new Date(NOW.getTime() + 14 * 60 * 1000),
  };

  it("restores the previous state while the failed code is still there, and keeps the token", async () => {
    const { legacy: repo } = repoWithPendingSignup();
    await repo.rotateVerificationToken(key, "newer-token");

    await repo.restoreVerificationCode(key, "code-hash", previous);

    expect(await repo.findVerificationCode(key)).toMatchObject({
      ...previous,
      tokenHash: "newer-token",
    });
  });

  it("does nothing once the code was replaced by a newer request", async () => {
    const { legacy: repo } = repoWithPendingSignup();

    await repo.restoreVerificationCode(key, "some-other-code", previous);

    expect(await repo.findVerificationCode(key)).toMatchObject({
      codeHash: "code-hash",
      codeSendCount: 1,
    });
  });
});

describe("legacy.incrementVerificationAttempts", () => {
  it("counts one more attempt", async () => {
    const { legacy: repo } = repoWithPendingSignup();
    const key = { userId: OWNER, purpose: "signup" as const };

    await repo.incrementVerificationAttempts(key);

    expect(await repo.findVerificationCode(key)).toMatchObject({
      codeAttempts: 1,
    });
  });
});

describe("legacy.verifyEmail", () => {
  const input = {
    userId: OWNER,
    tokenHash: "token-hash",
    codeHash: "code-hash",
    verifiedAt: NOW,
    session: session("s-new"),
  };

  it("consumes the code, confirms the account and opens a session", async () => {
    const store = repoWithPendingSignup();
    const repo = store.legacy;

    await expect(repo.verifyEmail(input)).resolves.toBe(true);

    expect(await repo.findUserById(OWNER)).toMatchObject({
      emailVerifiedAt: NOW,
    });
    expect(store.verificationCodes.size).toBe(0);
    expect(await repo.findSessionByTokenHash("session-s-new")).toEqual({
      id: "s-new",
      userId: OWNER,
      expiresAt: SESSION_EXPIRES_AT,
    });
  });

  it.each([
    ["a rotated token", { tokenHash: "stale-token" }],
    ["a code that was reissued", { codeHash: "stale-code" }],
  ])("loses the race against %s", async (_name, override) => {
    const store = repoWithPendingSignup();
    const repo = store.legacy;

    await expect(repo.verifyEmail({ ...input, ...override })).resolves.toBe(
      false,
    );

    expect(await repo.findUserById(OWNER)).toMatchObject({
      emailVerifiedAt: null,
    });
    expect(store.verificationCodes.size).toBe(1);
    expect(store.sessions.size).toBe(0);
  });

  it("never opens a session for an account already confirmed", async () => {
    const store = createInMemoryStore({
      users: [{ id: OWNER, email: "user@example.com" }],
      verificationCodes: [
        {
          userId: OWNER,
          purpose: "signup",
          tokenHash: "token-hash",
          codeHash: "code-hash",
          issuedAt: NOW,
        },
      ],
    });

    await expect(store.legacy.verifyEmail(input)).resolves.toBe(false);

    expect(store.sessions.size).toBe(0);
  });
});

describe("legacy.resetPassword", () => {
  const input = {
    userId: OWNER,
    tokenHash: "token-hash",
    codeHash: "code-hash",
    passwordHash: "new-hash",
    session: session("s-new"),
  };

  it("consumes the code, swaps the password and replaces every session of the user", async () => {
    const store = repoWithResetCode();
    const repo = store.legacy;

    await expect(repo.resetPassword(input)).resolves.toBe(true);

    expect(await repo.findUserById(OWNER)).toMatchObject({
      passwordHash: "new-hash",
    });
    expect(store.verificationCodes.size).toBe(0);
    expect(await repo.findSessionByTokenHash("phone")).toBeUndefined();
    expect(await repo.findSessionByTokenHash("session-s-new")).toMatchObject({
      userId: OWNER,
    });
    expect(await repo.findSessionByTokenHash("stranger")).toBeDefined();
  });

  it.each([
    ["a rotated token", { tokenHash: "stale-token" }],
    ["a code that was reissued", { codeHash: "stale-code" }],
  ])("changes nothing against %s", async (_name, override) => {
    const store = repoWithResetCode();
    const repo = store.legacy;

    await expect(repo.resetPassword({ ...input, ...override })).resolves.toBe(
      false,
    );

    expect(await repo.findUserById(OWNER)).toMatchObject({
      passwordHash: "old-hash",
    });
    expect(await repo.findSessionByTokenHash("phone")).toBeDefined();
    expect(store.verificationCodes.size).toBe(1);
  });
});

describe("legacy.changePassword", () => {
  it("swaps the password and deletes every other session of the user", async () => {
    const store = createInMemoryStore({
      users: [{ id: OWNER, email: "user@example.com" }],
      sessions: [
        { id: "current", userId: OWNER, tokenHash: "current" },
        { id: "laptop", userId: OWNER, tokenHash: "laptop" },
      ],
    });

    await store.legacy.changePassword({
      userId: OWNER,
      passwordHash: "new-hash",
      exceptSessionId: "current",
    });

    expect(await store.legacy.findUserById(OWNER)).toMatchObject({
      passwordHash: "new-hash",
    });
    expect([...store.sessions.keys()]).toEqual(["current"]);
  });
});

describe("legacy sessions", () => {
  function repoWithSessions() {
    return createInMemoryStore({
      sessions: [
        {
          id: "old",
          userId: OWNER,
          tokenHash: "old",
          createdAt: new Date(NOW.getTime() - 120_000),
          expiresAt: NOW,
        },
        {
          id: "current",
          userId: OWNER,
          tokenHash: "current",
          deviceLabel: "Chrome",
          createdAt: NOW,
          expiresAt: SESSION_EXPIRES_AT,
        },
        {
          id: "laptop",
          userId: OWNER,
          tokenHash: "laptop",
          createdAt: new Date(NOW.getTime() - 30_000),
          expiresAt: SESSION_EXPIRES_AT,
        },
        {
          id: "stranger",
          userId: OTHER,
          tokenHash: "stranger",
          createdAt: NOW,
        },
      ],
    });
  }

  it("deletes the session behind a token hash and ignores an unknown one", async () => {
    const store = repoWithSessions();
    const repo = store.legacy;

    await repo.deleteSessionByTokenHash("laptop");
    await repo.deleteSessionByTokenHash("unknown");

    expect(await repo.findSessionByTokenHash("laptop")).toBeUndefined();
    expect(store.sessions.size).toBe(3);
  });

  it("deletes every session of the user except the one named", async () => {
    const store = repoWithSessions();

    await expect(
      store.legacy.deleteUserSessions({
        userId: OWNER,
        exceptSessionId: "current",
      }),
    ).resolves.toEqual({ deletedCount: 2 });

    expect([...store.sessions.keys()].sort()).toEqual(["current", "stranger"]);
  });

  it("deletes literally every session of the user without an exception", async () => {
    const store = repoWithSessions();

    await expect(
      store.legacy.deleteUserSessions({ userId: OWNER }),
    ).resolves.toEqual({
      deletedCount: 3,
    });

    expect([...store.sessions.keys()]).toEqual(["stranger"]);
  });

  it("deletes one session only for its owner", async () => {
    const store = repoWithSessions();
    const repo = store.legacy;

    await expect(
      repo.deleteUserSession({ id: "stranger", userId: OWNER }),
    ).resolves.toEqual({ deleted: false });
    await expect(
      repo.deleteUserSession({ id: "laptop", userId: OWNER }),
    ).resolves.toEqual({ deleted: true });
    await expect(
      repo.deleteUserSession({ id: "laptop", userId: OWNER }),
    ).resolves.toEqual({ deleted: false });

    expect(store.sessions.has("stranger")).toBe(true);
  });

  it("lists the user's sessions still active at the instant, newest first", async () => {
    const store = repoWithSessions();

    const listed = await store.legacy.listUserSessions({
      userId: OWNER,
      activeAt: NOW,
    });

    expect(listed).toEqual([
      {
        id: "current",
        deviceLabel: "Chrome",
        createdAt: NOW,
        expiresAt: SESSION_EXPIRES_AT,
      },
      {
        id: "laptop",
        deviceLabel: null,
        createdAt: new Date(NOW.getTime() - 30_000),
        expiresAt: SESSION_EXPIRES_AT,
      },
    ]);
  });
});

describe("repositories.users", () => {
  const db = {} as never;

  describe("upsertUnverified", () => {
    it("creates a new unconfirmed account", async () => {
      const store = createInMemoryStore();
      const repo = store.repositories.users(db);

      await expect(
        repo.upsertUnverified({
          id: OWNER,
          email: "user@example.com",
          passwordHash: "hash-1",
        }),
      ).resolves.toEqual({ userId: OWNER });

      expect(store.users.get(OWNER)).toMatchObject({
        email: "user@example.com",
        passwordHash: "hash-1",
        emailVerifiedAt: null,
      });
    });

    it("replaces the password of an account still pending", async () => {
      const store = createInMemoryStore({
        users: [
          {
            id: OWNER,
            email: "user@example.com",
            passwordHash: "old-hash",
            emailVerifiedAt: null,
          },
        ],
      });
      const repo = store.repositories.users(db);

      await expect(
        repo.upsertUnverified({
          id: OTHER,
          email: "user@example.com",
          passwordHash: "new-hash",
        }),
      ).resolves.toEqual({ userId: OWNER });

      expect(store.users.size).toBe(1);
      expect(store.users.get(OWNER)).toMatchObject({
        passwordHash: "new-hash",
      });
    });

    it("refuses an account already confirmed and leaves it untouched", async () => {
      const store = createInMemoryStore({
        users: [
          { id: OWNER, email: "user@example.com", passwordHash: "old-hash" },
        ],
      });
      const repo = store.repositories.users(db);

      await expect(
        repo.upsertUnverified({
          id: OTHER,
          email: "user@example.com",
          passwordHash: "new-hash",
        }),
      ).resolves.toBe(null);

      expect(store.users.size).toBe(1);
      expect(store.users.get(OWNER)).toMatchObject({
        passwordHash: "old-hash",
      });
    });
  });

  describe("markVerified", () => {
    it("confirms an account still pending", async () => {
      const store = createInMemoryStore({
        users: [
          { id: OWNER, email: "user@example.com", emailVerifiedAt: null },
        ],
      });
      const repo = store.repositories.users(db);

      await expect(repo.markVerified(OWNER, NOW)).resolves.toBe(true);
      expect(store.users.get(OWNER)).toMatchObject({ emailVerifiedAt: NOW });
    });

    it("returns false when the account is already confirmed", async () => {
      const store = createInMemoryStore({
        users: [{ id: OWNER, email: "user@example.com" }],
      });
      const repo = store.repositories.users(db);

      await expect(repo.markVerified(OWNER, NOW)).resolves.toBe(false);
    });
  });

  describe("purgeAbandonedUnverified", () => {
    it("deletes an unconfirmed account with no verification code left", async () => {
      const store = createInMemoryStore({
        users: [
          { id: OWNER, email: "user@example.com", emailVerifiedAt: null },
        ],
      });
      const repo = store.repositories.users(db);

      await expect(repo.purgeAbandonedUnverified()).resolves.toBe(1);
      expect(store.users.has(OWNER)).toBe(false);
    });

    it("keeps an unconfirmed account that still has a live code", async () => {
      const store = repoWithPendingSignup();
      const repo = store.repositories.users(db);

      await expect(repo.purgeAbandonedUnverified()).resolves.toBe(0);
      expect(store.users.has(OWNER)).toBe(true);
    });

    it("never touches a confirmed account", async () => {
      const store = createInMemoryStore({
        users: [{ id: OWNER, email: "user@example.com" }],
      });
      const repo = store.repositories.users(db);

      await expect(repo.purgeAbandonedUnverified()).resolves.toBe(0);
      expect(store.users.has(OWNER)).toBe(true);
    });
  });
});

describe("repositories.credentialThrottle", () => {
  const db = {} as never;

  it("upserts a failure, reads it back and clears it", async () => {
    const repo = createInMemoryStore().repositories.credentialThrottle(db);
    const now = NOW;

    expect(await repo.findThrottleByKeyHash("key-hash")).toBeUndefined();

    await repo.upsertThrottleFailure({
      keyHash: "key-hash",
      failedCount: 1,
      lastFailedAt: now,
    });

    expect(await repo.findThrottleByKeyHash("key-hash")).toEqual({
      failedCount: 1,
      lastFailedAt: now,
    });

    await repo.clearThrottle("key-hash");

    expect(await repo.findThrottleByKeyHash("key-hash")).toBeUndefined();
  });

  it("purges trails whose last failure is before the cutoff", async () => {
    const store = createInMemoryStore();
    const repo = store.repositories.credentialThrottle(db);
    store.throttle.set("stale-hash", {
      failedCount: 1,
      lastFailedAt: new Date(NOW.getTime() - 1000),
    });
    store.throttle.set("fresh-hash", { failedCount: 1, lastFailedAt: NOW });

    await expect(repo.purgeStale(NOW)).resolves.toBe(1);

    expect(store.throttle.has("stale-hash")).toBe(false);
    expect(store.throttle.has("fresh-hash")).toBe(true);
  });
});

describe("repositories.otp", () => {
  const db = {} as never;
  const key = { userId: OWNER, purpose: "signup" as const };

  it("reads a code with its owner's email and password hash", async () => {
    const repo = repoWithPendingSignup().repositories.otp(db);

    expect(await repo.find(key)).toEqual({
      ...CODE,
      ...key,
      email: "user@example.com",
      passwordHash: "seeded-hash",
    });
    expect(
      await repo.find({ userId: OWNER, purpose: "password_reset" }),
    ).toBeUndefined();
  });

  it("finds a code by token hash only within the given purpose", async () => {
    const repo = repoWithPendingSignup().repositories.otp(db);

    expect(
      await repo.findByTokenHash("password_reset", "token-hash"),
    ).toBeUndefined();
    expect(await repo.findByTokenHash("signup", "token-hash")).toMatchObject({
      userId: OWNER,
      email: "user@example.com",
    });
  });

  it("saves a new code and replaces the one on file for the same key", async () => {
    const store = createInMemoryStore({
      users: [{ id: OWNER, email: "user@example.com" }],
    });
    const repo = store.repositories.otp(db);

    await repo.save({ ...key, ...CODE });
    await repo.save({ ...key, ...CODE, codeHash: "newer", codeSendCount: 2 });

    expect(store.verificationCodes.size).toBe(1);
    expect(await repo.find(key)).toMatchObject({
      codeHash: "newer",
      codeSendCount: 2,
    });
  });

  it("rotates the token and keeps the code", async () => {
    const repo = repoWithPendingSignup().repositories.otp(db);

    await repo.rotateToken(key, "rotated");

    expect(await repo.find(key)).toMatchObject({
      tokenHash: "rotated",
      codeHash: "code-hash",
    });
  });

  describe("restore", () => {
    const previous = {
      codeHash: "previous-code",
      codeAttempts: 2,
      codeSendCount: 3,
      issuedAt: new Date(NOW.getTime() - 60_000),
      expiresAt: new Date(NOW.getTime() + 14 * 60 * 1000),
    };

    it("restores the previous state while the failed code is still there, and keeps the token", async () => {
      const repo = repoWithPendingSignup().repositories.otp(db);
      await repo.rotateToken(key, "newer-token");

      await repo.restore(key, "code-hash", previous);

      expect(await repo.find(key)).toMatchObject({
        ...previous,
        tokenHash: "newer-token",
      });
    });

    it("does nothing once the code was replaced by a newer request", async () => {
      const repo = repoWithPendingSignup().repositories.otp(db);

      await repo.restore(key, "some-other-code", previous);

      expect(await repo.find(key)).toMatchObject({
        codeHash: "code-hash",
        codeSendCount: 1,
      });
    });
  });

  it("counts one more attempt", async () => {
    const repo = repoWithPendingSignup().repositories.otp(db);

    await repo.incrementAttempts(key);

    expect(await repo.find(key)).toMatchObject({ codeAttempts: 1 });
  });

  describe("consume", () => {
    const input = {
      userId: OWNER,
      tokenHash: "token-hash",
      codeHash: "code-hash",
    };

    it("deletes the code when both hashes match", async () => {
      const store = repoWithPendingSignup();

      await expect(
        store.repositories.otp(db).consume("signup", input),
      ).resolves.toBe(true);
      expect(store.verificationCodes.size).toBe(0);
    });

    it("keeps the code when the token, the code or the purpose differ", async () => {
      const store = repoWithPendingSignup();
      const repo = store.repositories.otp(db);

      await expect(
        repo.consume("signup", { ...input, tokenHash: "rotated" }),
      ).resolves.toBe(false);
      await expect(
        repo.consume("signup", { ...input, codeHash: "reissued" }),
      ).resolves.toBe(false);
      await expect(repo.consume("password_reset", input)).resolves.toBe(false);
      expect(store.verificationCodes.size).toBe(1);
    });
  });

  it("purges the codes expired at the instant, the boundary included", async () => {
    const store = createInMemoryStore({
      users: [{ id: OWNER, email: "user@example.com" }],
      verificationCodes: [
        { ...key, issuedAt: NOW, expiresAt: NOW },
        {
          userId: OWNER,
          purpose: "password_reset",
          issuedAt: NOW,
          expiresAt: new Date(NOW.getTime() + 1),
        },
      ],
    });

    await expect(store.repositories.otp(db).purgeExpired(NOW)).resolves.toBe(1);
    expect([...store.verificationCodes.keys()]).toEqual([
      `${OWNER}:password_reset`,
    ]);
  });
});
