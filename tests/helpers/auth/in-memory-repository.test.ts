import { describe, expect, it } from "vitest";
import { createInMemoryAuthRepository } from "./in-memory-repository.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const CODE = {
  tokenHash: "token-hash",
  codeHash: "code-hash",
  codeAttempts: 0,
  codeSendCount: 1,
  issuedAt: NOW,
};

function newUser(
  overrides: Partial<{ id: string; passwordHash: string }> = {},
) {
  return {
    id: OWNER,
    email: "user@example.com",
    passwordHash: "hash-1",
    createdAt: NOW,
    ...overrides,
  };
}

function session(id: string) {
  return { id, tokenHash: `session-${id}`, deviceLabel: null, createdAt: NOW };
}

function repoWithPendingSignup() {
  return createInMemoryAuthRepository({
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
  return createInMemoryAuthRepository({
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

describe("startSignup", () => {
  it("creates an unconfirmed account with its signup code", async () => {
    const repo = createInMemoryAuthRepository();

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
    const repo = createInMemoryAuthRepository({
      users: [
        { id: OWNER, email: "user@example.com", passwordHash: "old-hash" },
      ],
    });

    await expect(repo.startSignup(newUser({ id: OTHER }), CODE)).resolves.toBe(
      null,
    );

    expect(await repo.findUserById(OWNER)).toMatchObject({
      passwordHash: "old-hash",
    });
    expect(repo.users.size).toBe(1);
    expect(repo.verificationCodes.size).toBe(0);
  });

  it("overwrites the password of an unconfirmed account and replaces its token", async () => {
    const repo = repoWithPendingSignup();

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
    expect(repo.users.size).toBe(1);
    expect(
      await repo.findVerificationCodeByTokenHash("signup", "token-hash"),
    ).toBeUndefined();
    expect(
      await repo.findVerificationCodeByTokenHash("signup", "token-hash-2"),
    ).toMatchObject({ userId: OWNER, passwordHash: "hash-2" });
  });
});

describe("findVerificationCodeByTokenHash", () => {
  it("only matches a code of the given purpose", async () => {
    const repo = repoWithPendingSignup();

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

describe("rotateVerificationToken", () => {
  it("replaces the token and keeps the code", async () => {
    const repo = repoWithPendingSignup();
    const key = { userId: OWNER, purpose: "signup" as const };

    await repo.rotateVerificationToken(key, "rotated");

    expect(await repo.findVerificationCode(key)).toMatchObject({
      tokenHash: "rotated",
      codeHash: "code-hash",
    });
  });
});

describe("restoreVerificationCode", () => {
  const key = { userId: OWNER, purpose: "signup" as const };
  const previous = {
    codeHash: "previous-code",
    codeAttempts: 2,
    codeSendCount: 3,
    issuedAt: new Date(NOW.getTime() - 60_000),
  };

  it("restores the previous state while the failed code is still there, and keeps the token", async () => {
    const repo = repoWithPendingSignup();
    await repo.rotateVerificationToken(key, "newer-token");

    await repo.restoreVerificationCode(key, "code-hash", previous);

    expect(await repo.findVerificationCode(key)).toMatchObject({
      ...previous,
      tokenHash: "newer-token",
    });
  });

  it("does nothing once the code was replaced by a newer request", async () => {
    const repo = repoWithPendingSignup();

    await repo.restoreVerificationCode(key, "some-other-code", previous);

    expect(await repo.findVerificationCode(key)).toMatchObject({
      codeHash: "code-hash",
      codeSendCount: 1,
    });
  });
});

describe("incrementVerificationAttempts", () => {
  it("counts one more attempt", async () => {
    const repo = repoWithPendingSignup();
    const key = { userId: OWNER, purpose: "signup" as const };

    await repo.incrementVerificationAttempts(key);

    expect(await repo.findVerificationCode(key)).toMatchObject({
      codeAttempts: 1,
    });
  });
});

describe("verifyEmail", () => {
  const input = {
    userId: OWNER,
    tokenHash: "token-hash",
    codeHash: "code-hash",
    verifiedAt: NOW,
    session: session("s-new"),
  };

  it("consumes the code, confirms the account and opens a session", async () => {
    const repo = repoWithPendingSignup();

    await expect(repo.verifyEmail(input)).resolves.toBe(true);

    expect(await repo.findUserById(OWNER)).toMatchObject({
      emailVerifiedAt: NOW,
    });
    expect(repo.verificationCodes.size).toBe(0);
    expect(await repo.findSessionByTokenHash("session-s-new")).toEqual({
      id: "s-new",
      userId: OWNER,
      createdAt: NOW,
    });
  });

  it.each([
    ["a rotated token", { tokenHash: "stale-token" }],
    ["a code that was reissued", { codeHash: "stale-code" }],
  ])("loses the race against %s", async (_name, override) => {
    const repo = repoWithPendingSignup();

    await expect(repo.verifyEmail({ ...input, ...override })).resolves.toBe(
      false,
    );

    expect(await repo.findUserById(OWNER)).toMatchObject({
      emailVerifiedAt: null,
    });
    expect(repo.verificationCodes.size).toBe(1);
    expect(repo.sessions.size).toBe(0);
  });

  it("never opens a session for an account already confirmed", async () => {
    const repo = createInMemoryAuthRepository({
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

    await expect(repo.verifyEmail(input)).resolves.toBe(false);

    expect(repo.sessions.size).toBe(0);
  });
});

describe("resetPassword", () => {
  const input = {
    userId: OWNER,
    tokenHash: "token-hash",
    codeHash: "code-hash",
    passwordHash: "new-hash",
    session: session("s-new"),
  };

  it("consumes the code, swaps the password and replaces every session of the user", async () => {
    const repo = repoWithResetCode();

    await expect(repo.resetPassword(input)).resolves.toBe(true);

    expect(await repo.findUserById(OWNER)).toMatchObject({
      passwordHash: "new-hash",
    });
    expect(repo.verificationCodes.size).toBe(0);
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
    const repo = repoWithResetCode();

    await expect(repo.resetPassword({ ...input, ...override })).resolves.toBe(
      false,
    );

    expect(await repo.findUserById(OWNER)).toMatchObject({
      passwordHash: "old-hash",
    });
    expect(await repo.findSessionByTokenHash("phone")).toBeDefined();
    expect(repo.verificationCodes.size).toBe(1);
  });
});

describe("changePassword", () => {
  it("swaps the password and deletes every other session of the user", async () => {
    const repo = createInMemoryAuthRepository({
      users: [{ id: OWNER, email: "user@example.com" }],
      sessions: [
        { id: "current", userId: OWNER, tokenHash: "current" },
        { id: "laptop", userId: OWNER, tokenHash: "laptop" },
      ],
    });

    await repo.changePassword({
      userId: OWNER,
      passwordHash: "new-hash",
      exceptSessionId: "current",
    });

    expect(await repo.findUserById(OWNER)).toMatchObject({
      passwordHash: "new-hash",
    });
    expect([...repo.sessions.keys()]).toEqual(["current"]);
  });
});

describe("sessions", () => {
  function repoWithSessions() {
    return createInMemoryAuthRepository({
      sessions: [
        {
          id: "old",
          userId: OWNER,
          tokenHash: "old",
          createdAt: new Date(NOW.getTime() - 120_000),
        },
        {
          id: "current",
          userId: OWNER,
          tokenHash: "current",
          deviceLabel: "Chrome",
          createdAt: NOW,
        },
        {
          id: "laptop",
          userId: OWNER,
          tokenHash: "laptop",
          createdAt: new Date(NOW.getTime() - 30_000),
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
    const repo = repoWithSessions();

    await repo.deleteSessionByTokenHash("laptop");
    await repo.deleteSessionByTokenHash("unknown");

    expect(await repo.findSessionByTokenHash("laptop")).toBeUndefined();
    expect(repo.sessions.size).toBe(3);
  });

  it("deletes every session of the user except the one named", async () => {
    const repo = repoWithSessions();

    await expect(
      repo.deleteUserSessions({ userId: OWNER, exceptSessionId: "current" }),
    ).resolves.toEqual({ deletedCount: 2 });

    expect([...repo.sessions.keys()].sort()).toEqual(["current", "stranger"]);
  });

  it("deletes literally every session of the user without an exception", async () => {
    const repo = repoWithSessions();

    await expect(repo.deleteUserSessions({ userId: OWNER })).resolves.toEqual({
      deletedCount: 3,
    });

    expect([...repo.sessions.keys()]).toEqual(["stranger"]);
  });

  it("deletes one session only for its owner", async () => {
    const repo = repoWithSessions();

    await expect(
      repo.deleteUserSession({ id: "stranger", userId: OWNER }),
    ).resolves.toEqual({ deleted: false });
    await expect(
      repo.deleteUserSession({ id: "laptop", userId: OWNER }),
    ).resolves.toEqual({ deleted: true });
    await expect(
      repo.deleteUserSession({ id: "laptop", userId: OWNER }),
    ).resolves.toEqual({ deleted: false });

    expect(repo.sessions.has("stranger")).toBe(true);
  });

  it("lists the user's sessions created after the cutoff, newest first", async () => {
    const repo = repoWithSessions();

    const listed = await repo.listUserSessions({
      userId: OWNER,
      createdAfter: new Date(NOW.getTime() - 60_000),
    });

    expect(listed).toEqual([
      { id: "current", deviceLabel: "Chrome", createdAt: NOW },
      {
        id: "laptop",
        deviceLabel: null,
        createdAt: new Date(NOW.getTime() - 30_000),
      },
    ]);
  });
});
