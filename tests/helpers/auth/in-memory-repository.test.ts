import { describe, expect, it } from "vitest";
import { createInMemoryAuthRepository } from "./in-memory-repository.js";

const NOW = new Date("2026-09-20T12:00:00Z");

function pendingInput(overrides: Record<string, unknown> = {}) {
  return {
    email: "user@example.com",
    passwordHash: "hash",
    codeHash: "code-hash",
    signupSessionToken: "token-1",
    expiresAt: new Date(NOW.getTime() + 900_000),
    now: NOW,
    ...overrides,
  };
}

describe("in-memory auth repository", () => {
  it("seeds auth users and finds them by email", async () => {
    const repo = createInMemoryAuthRepository({
      authUsers: [{ email: "a@b.com", passwordHash: "h" }],
    });
    const user = await repo.findAuthUserByEmail("a@b.com");
    expect(user).toMatchObject({ id: 1, passwordHash: "h" });
    expect(user?.publicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await repo.findAuthUserByEmail("zz@b.com")).toBeUndefined();
  });

  it("upserts a pending signup and finds it by email and by token", async () => {
    const repo = createInMemoryAuthRepository();
    const { id } = await repo.upsertPendingSignup(pendingInput());
    expect(id).toBe(1);
    expect(
      await repo.findPendingSignupByEmail("user@example.com"),
    ).toMatchObject({
      id,
      signupSessionToken: "token-1",
      codeAttempts: 0,
      codeSendCount: 1,
    });
    expect(await repo.findPendingSignupBySessionToken("token-1")).toMatchObject(
      {
        email: "user@example.com",
        lastSentAt: NOW,
      },
    );
  });

  it("upsert on the same email replaces the row and resets counters", async () => {
    const repo = createInMemoryAuthRepository();
    const first = await repo.upsertPendingSignup(pendingInput());
    await repo.incrementCodeAttempts("token-1");
    const second = await repo.upsertPendingSignup(
      pendingInput({ signupSessionToken: "token-2" }),
    );
    expect(second.id).toBe(first.id);
    expect(
      await repo.findPendingSignupBySessionToken("token-1"),
    ).toBeUndefined();
    expect(await repo.findPendingSignupBySessionToken("token-2")).toMatchObject(
      {
        codeAttempts: 0,
        codeSendCount: 1,
      },
    );
  });

  it("marks undelivered, updates resend state and increments attempts", async () => {
    const repo = createInMemoryAuthRepository();
    await repo.upsertPendingSignup(pendingInput());
    await repo.markPendingSignupUndelivered("user@example.com");
    expect(
      (await repo.findPendingSignupByEmail("user@example.com"))?.codeSendCount,
    ).toBe(0);

    await repo.updatePendingSignupResendState("token-1", {
      codeHash: "new-hash",
      expiresAt: new Date(NOW.getTime() + 1_000),
      codeAttempts: 0,
      lastSentAt: NOW,
      codeSendCount: 3,
    });
    await repo.incrementCodeAttempts("token-1");
    expect(await repo.findPendingSignupBySessionToken("token-1")).toMatchObject(
      {
        codeHash: "new-hash",
        codeAttempts: 1,
        codeSendCount: 3,
      },
    );
  });

  it("promotes a pending signup into user, session and profile atomically", async () => {
    const repo = createInMemoryAuthRepository();
    await repo.upsertPendingSignup(pendingInput());
    const user = await repo.promotePendingSignup({
      email: "user@example.com",
      passwordHash: "hash",
      signupSessionToken: "token-1",
      sessionTokenHash: "session-hash",
      deviceLabel: "Mozilla/5.0",
      sessionExpiresAt: new Date(NOW.getTime() + 1_000),
    });
    expect(user.id).toBe(1);
    expect(await repo.findAuthUserByEmail("user@example.com")).toMatchObject({
      id: 1,
      passwordHash: "hash",
    });
    expect(repo.pendingSignups.size).toBe(0);
    expect(repo.sessions).toEqual([
      {
        id: 1,
        userId: 1,
        tokenHash: "session-hash",
        deviceLabel: "Mozilla/5.0",
        expiresAt: new Date(NOW.getTime() + 1_000),
        revokedAt: null,
        revokedReason: null,
      },
    ]);
    expect(repo.profiles).toEqual([{ userId: 1 }]);
  });

  it("creates sessions for existing users", async () => {
    const repo = createInMemoryAuthRepository({
      authUsers: [{ id: 7, email: "a@b.com", passwordHash: "h" }],
    });
    await repo.createSession({
      userId: 7,
      tokenHash: "t",
      deviceLabel: null,
      expiresAt: NOW,
    });
    expect(repo.sessions).toEqual([
      {
        id: 1,
        userId: 7,
        tokenHash: "t",
        deviceLabel: null,
        expiresAt: NOW,
        revokedAt: null,
        revokedReason: null,
      },
    ]);
  });

  it("seeds sessions and finds them by token hash", async () => {
    const repo = createInMemoryAuthRepository({
      authUsers: [{ email: "a@b.com", id: 7 }],
      sessions: [
        {
          userId: 7,
          tokenHash: "hash-1",
          expiresAt: new Date(NOW.getTime() + 1000),
        },
      ],
    });
    const session = await repo.findSessionByTokenHash("hash-1");
    expect(session).toMatchObject({ userId: 7, revokedAt: null });
    expect(await repo.findSessionByTokenHash("unknown")).toBeUndefined();
  });

  it("keeps the revoked_at given in the seed", async () => {
    const revokedAt = new Date(NOW.getTime() - 1000);
    const repo = createInMemoryAuthRepository({
      authUsers: [{ email: "a@b.com", id: 7 }],
      sessions: [{ userId: 7, tokenHash: "hash-1", expiresAt: NOW, revokedAt }],
    });
    expect((await repo.findSessionByTokenHash("hash-1"))?.revokedAt).toEqual(
      revokedAt,
    );
  });

  it("finds sessions created through createSession", async () => {
    const repo = createInMemoryAuthRepository();
    await repo.createSession({
      userId: 3,
      tokenHash: "hash-2",
      deviceLabel: null,
      expiresAt: new Date(NOW.getTime() + 1000),
    });
    expect(await repo.findSessionByTokenHash("hash-2")).toMatchObject({
      userId: 3,
      revokedAt: null,
    });
  });

  it("finds an auth user by id, without the password hash", async () => {
    const repo = createInMemoryAuthRepository({
      authUsers: [
        {
          id: 7,
          email: "a@b.com",
          publicId: "11111111-1111-4111-8111-111111111111",
        },
      ],
    });
    expect(await repo.findAuthUserById(7)).toEqual({
      publicId: "11111111-1111-4111-8111-111111111111",
      email: "a@b.com",
    });
    expect(await repo.findAuthUserById(999)).toBeUndefined();
  });
});

describe("revokeSessionByTokenHash", () => {
  function repoWithTwoSessions() {
    return createInMemoryAuthRepository({
      sessions: [
        {
          id: 1,
          userId: 7,
          tokenHash: "hash-a",
          expiresAt: new Date(Date.now() + 60_000),
        },
        {
          id: 2,
          userId: 7,
          tokenHash: "hash-b",
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });
  }

  it("revokes only the session behind the given hash", async () => {
    const repo = repoWithTwoSessions();
    const revokedAt = new Date("2026-09-23T12:00:00Z");

    await repo.revokeSessionByTokenHash("hash-a", revokedAt, "user_logout");

    expect(repo.sessions[0]).toMatchObject({
      revokedAt,
      revokedReason: "user_logout",
    });
    expect(repo.sessions[1]).toMatchObject({
      revokedAt: null,
      revokedReason: null,
    });
  });

  it("keeps the first revocation when the same session is revoked twice", async () => {
    const repo = repoWithTwoSessions();
    const first = new Date("2026-09-23T12:00:00Z");
    const second = new Date("2026-09-23T13:00:00Z");

    await repo.revokeSessionByTokenHash("hash-a", first, "user_logout");
    await repo.revokeSessionByTokenHash("hash-a", second, "user_logout");

    expect(repo.sessions[0]).toMatchObject({ revokedAt: first });
  });

  it("does nothing when no session matches the hash", async () => {
    const repo = repoWithTwoSessions();

    await repo.revokeSessionByTokenHash(
      "hash-unknown",
      new Date(),
      "user_logout",
    );

    expect(repo.sessions.every((s) => s.revokedAt === null)).toBe(true);
  });
});

describe("revokeAllUserSessions", () => {
  const REVOKED_AT = new Date("2026-09-23T12:00:00Z");

  function repoWithSessions() {
    const expiresAt = new Date("2026-10-23T12:00:00Z");
    return createInMemoryAuthRepository({
      authUsers: [
        { id: 7, email: "a@b.com" },
        { id: 8, email: "c@d.com" },
      ],
      sessions: [
        { id: 1, userId: 7, tokenHash: "hash-1", expiresAt },
        { id: 2, userId: 7, tokenHash: "hash-2", expiresAt },
        { id: 3, userId: 7, tokenHash: "hash-3", expiresAt },
        { id: 4, userId: 8, tokenHash: "hash-4", expiresAt },
      ],
    });
  }

  it("revokes every session of the user when no session is excluded", async () => {
    const repo = repoWithSessions();

    const result = await repo.revokeAllUserSessions({
      userId: 7,
      revokedAt: REVOKED_AT,
      revokedReason: "logout_all",
    });

    expect(result).toEqual({ revokedCount: 3 });
    expect(repo.sessions.filter((s) => s.userId === 7)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          revokedAt: REVOKED_AT,
          revokedReason: "logout_all",
        }),
      ]),
    );
  });

  it("keeps the excluded session untouched", async () => {
    const repo = repoWithSessions();

    const result = await repo.revokeAllUserSessions({
      userId: 7,
      revokedAt: REVOKED_AT,
      revokedReason: "logout_all",
      exceptSessionId: 2,
    });

    expect(result).toEqual({ revokedCount: 2 });
    expect(repo.sessions.find((s) => s.id === 2)).toMatchObject({
      revokedAt: null,
      revokedReason: null,
    });
  });

  it("never touches a session of another user", async () => {
    const repo = repoWithSessions();

    await repo.revokeAllUserSessions({
      userId: 7,
      revokedAt: REVOKED_AT,
      revokedReason: "logout_all",
    });

    expect(repo.sessions.find((s) => s.id === 4)).toMatchObject({
      revokedAt: null,
      revokedReason: null,
    });
  });

  it("does not count or overwrite a session that was already revoked", async () => {
    const alreadyRevokedAt = new Date("2026-09-01T00:00:00Z");
    const repo = createInMemoryAuthRepository({
      authUsers: [{ id: 7, email: "a@b.com" }],
      sessions: [
        {
          id: 1,
          userId: 7,
          tokenHash: "hash-1",
          expiresAt: new Date("2026-10-23T12:00:00Z"),
          revokedAt: alreadyRevokedAt,
        },
        {
          id: 2,
          userId: 7,
          tokenHash: "hash-2",
          expiresAt: new Date("2026-10-23T12:00:00Z"),
        },
      ],
    });

    const result = await repo.revokeAllUserSessions({
      userId: 7,
      revokedAt: REVOKED_AT,
      revokedReason: "logout_all",
    });

    expect(result).toEqual({ revokedCount: 1 });
    expect(repo.sessions.find((s) => s.id === 1)?.revokedAt).toBe(
      alreadyRevokedAt,
    );
  });

  it("revokes a session that is expired but not yet revoked", async () => {
    const repo = createInMemoryAuthRepository({
      authUsers: [{ id: 7, email: "a@b.com" }],
      sessions: [
        {
          id: 1,
          userId: 7,
          tokenHash: "hash-1",
          expiresAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });

    const result = await repo.revokeAllUserSessions({
      userId: 7,
      revokedAt: REVOKED_AT,
      revokedReason: "logout_all",
    });

    expect(result).toEqual({ revokedCount: 1 });
  });
});
