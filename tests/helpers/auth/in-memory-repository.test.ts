import { describe, expect, it } from "vitest";
import type { SessionRepository } from "../../../src/plugins/app/sessions/repository.js";
import { createInMemoryAuthRepository } from "./in-memory-repository.js";

const NOW = new Date("2026-09-20T12:00:00Z");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function repoWithTwoUsers() {
  const expiresAt = new Date(Date.now() + 60_000);
  return createInMemoryAuthRepository({
    authUsers: [
      { id: 1, email: "owner@example.com", passwordHash: "old-hash" },
      { id: 2, email: "other@example.com", passwordHash: "other-hash" },
    ],
    sessions: [
      { id: 10, userId: 1, tokenHash: "current", expiresAt },
      { id: 11, userId: 1, tokenHash: "laptop", expiresAt },
      { id: 12, userId: 2, tokenHash: "stranger", expiresAt },
    ],
  });
}

const outboxMessage = {
  type: "signup_code",
  recipient: "user@example.com",
  subject: "Your verification code: 123456",
  html: "<p>123456</p>",
  text: "123456",
};

function pendingInput(overrides: Record<string, unknown> = {}) {
  return {
    email: "user@example.com",
    passwordHash: "hash",
    codeHash: "code-hash",
    signupSessionToken: "token-1",
    expiresAt: new Date(NOW.getTime() + 900_000),
    now: NOW,
    message: outboxMessage,
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
    const { id } = await repo.upsertPendingSignupAndQueueEmail(pendingInput());
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
    const first = await repo.upsertPendingSignupAndQueueEmail(pendingInput());
    await repo.incrementCodeAttempts("token-1");
    const second = await repo.upsertPendingSignupAndQueueEmail(
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
    await repo.upsertPendingSignupAndQueueEmail(pendingInput());
    await repo.markPendingSignupUndelivered("user@example.com");
    expect(
      (await repo.findPendingSignupByEmail("user@example.com"))?.codeSendCount,
    ).toBe(0);

    await repo.updatePendingSignupResendStateAndQueueEmail(
      "token-1",
      {
        codeHash: "new-hash",
        expiresAt: new Date(NOW.getTime() + 1_000),
        codeAttempts: 0,
        lastSentAt: NOW,
        codeSendCount: 3,
      },
      outboxMessage,
    );
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
    await repo.upsertPendingSignupAndQueueEmail(pendingInput());
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
        publicId: expect.stringMatching(UUID),
        userId: 1,
        tokenHash: "session-hash",
        deviceLabel: "Mozilla/5.0",
        createdAt: expect.any(Date),
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
        publicId: expect.stringMatching(UUID),
        userId: 7,
        tokenHash: "t",
        deviceLabel: null,
        createdAt: expect.any(Date),
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

describe("listActiveUserSessions", () => {
  const NOW = new Date("2026-01-10T00:00:00.000Z");
  const future = new Date("2026-02-10T00:00:00.000Z");

  it("returns only the active sessions of the given user, newest first", async () => {
    const repo = createInMemoryAuthRepository({
      sessions: [
        {
          userId: 1,
          tokenHash: "older",
          publicId: "11111111-1111-4111-8111-111111111111",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          expiresAt: future,
        },
        {
          userId: 1,
          tokenHash: "newer",
          publicId: "22222222-2222-4222-8222-222222222222",
          createdAt: new Date("2026-01-05T00:00:00.000Z"),
          expiresAt: future,
        },
        {
          userId: 1,
          tokenHash: "revoked",
          createdAt: new Date("2026-01-06T00:00:00.000Z"),
          expiresAt: future,
          revokedAt: NOW,
        },
        {
          userId: 1,
          tokenHash: "expired",
          createdAt: new Date("2026-01-07T00:00:00.000Z"),
          expiresAt: new Date("2026-01-09T00:00:00.000Z"),
        },
        {
          userId: 2,
          tokenHash: "other-user",
          createdAt: new Date("2026-01-08T00:00:00.000Z"),
          expiresAt: future,
        },
      ],
    });

    const result = await repo.listActiveUserSessions({ userId: 1, now: NOW });

    expect(result.map((session) => session.publicId)).toEqual([
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("treats a session expiring exactly now as expired", async () => {
    const repo = createInMemoryAuthRepository({
      sessions: [{ userId: 1, tokenHash: "boundary", expiresAt: NOW }],
    });

    await expect(
      repo.listActiveUserSessions({ userId: 1, now: NOW }),
    ).resolves.toEqual([]);
  });

  it("gives every created session a public id", async () => {
    const repo = createInMemoryAuthRepository();
    await repo.createSession({
      userId: 1,
      tokenHash: "fresh",
      deviceLabel: null,
      expiresAt: future,
    });

    const [session] = await repo.listActiveUserSessions({
      userId: 1,
      now: NOW,
    });

    expect(session?.publicId).toMatch(UUID);
  });
});

describe("in-memory session repository", () => {
  it("satisfies the session port with the same store the auth port uses", async () => {
    const repo: SessionRepository = createInMemoryAuthRepository({
      authUsers: [{ id: 7, email: "foo@gmail.com" }],
      sessions: [
        {
          userId: 7,
          tokenHash: "hash",
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });

    const session = await repo.findSessionByTokenHash("hash");
    expect(session).toMatchObject({ userId: 7, revokedAt: null });
  });
});

describe("revokeUserSessionByPublicId", () => {
  const REVOKE_NOW = new Date("2026-02-01T00:00:00.000Z");
  const FUTURE = new Date("2026-03-01T00:00:00.000Z");
  const PUBLIC_ID = "33333333-3333-4333-8333-333333333333";

  function repoWith(
    overrides: {
      userId?: number;
      revokedAt?: Date | null;
      expiresAt?: Date;
    } = {},
  ) {
    return createInMemoryAuthRepository({
      sessions: [
        {
          userId: overrides.userId ?? 7,
          tokenHash: "hash",
          publicId: PUBLIC_ID,
          expiresAt: overrides.expiresAt ?? FUTURE,
          revokedAt: overrides.revokedAt ?? null,
        },
      ],
    });
  }

  it("revokes the session and reports it", async () => {
    const repo = repoWith();

    const result = await repo.revokeUserSessionByPublicId({
      publicId: PUBLIC_ID,
      userId: 7,
      revokedAt: REVOKE_NOW,
      revokedReason: "session_revoked",
      now: REVOKE_NOW,
    });

    expect(result).toEqual({ revoked: true });
    expect(repo.sessions[0]?.revokedAt).toEqual(REVOKE_NOW);
    expect(repo.sessions[0]?.revokedReason).toBe("session_revoked");
  });

  it("never revokes a session owned by another user", async () => {
    const repo = repoWith({ userId: 8 });

    const result = await repo.revokeUserSessionByPublicId({
      publicId: PUBLIC_ID,
      userId: 7,
      revokedAt: REVOKE_NOW,
      revokedReason: "session_revoked",
      now: REVOKE_NOW,
    });

    expect(result).toEqual({ revoked: false });
    expect(repo.sessions[0]?.revokedAt).toBeNull();
  });

  it("reports nothing revoked for an unknown public id", async () => {
    const repo = repoWith();

    const result = await repo.revokeUserSessionByPublicId({
      publicId: "44444444-4444-4444-8444-444444444444",
      userId: 7,
      revokedAt: REVOKE_NOW,
      revokedReason: "session_revoked",
      now: REVOKE_NOW,
    });

    expect(result).toEqual({ revoked: false });
  });

  it("keeps the first revocation date when the session was already revoked", async () => {
    const earlier = new Date("2026-01-01T00:00:00.000Z");
    const repo = repoWith({ revokedAt: earlier });

    const result = await repo.revokeUserSessionByPublicId({
      publicId: PUBLIC_ID,
      userId: 7,
      revokedAt: REVOKE_NOW,
      revokedReason: "session_revoked",
      now: REVOKE_NOW,
    });

    expect(result).toEqual({ revoked: false });
    expect(repo.sessions[0]?.revokedAt).toEqual(earlier);
  });

  it("leaves an expired session untouched", async () => {
    const repo = repoWith({ expiresAt: new Date("2026-01-15T00:00:00.000Z") });

    const result = await repo.revokeUserSessionByPublicId({
      publicId: PUBLIC_ID,
      userId: 7,
      revokedAt: REVOKE_NOW,
      revokedReason: "session_revoked",
      now: REVOKE_NOW,
    });

    expect(result).toEqual({ revoked: false });
    expect(repo.sessions[0]?.revokedAt).toBeNull();
  });
});

describe("findAuthUserCredentialsById", () => {
  it("returns the id, email and password hash", async () => {
    const repo = repoWithTwoUsers();

    await expect(repo.findAuthUserCredentialsById(1)).resolves.toEqual({
      id: 1,
      email: "owner@example.com",
      passwordHash: "old-hash",
    });
  });

  it("resolves undefined for an unknown id", async () => {
    const repo = repoWithTwoUsers();

    await expect(repo.findAuthUserCredentialsById(99)).resolves.toBeUndefined();
  });
});

describe("changeUserPassword", () => {
  const CHANGED_AT = new Date("2026-03-01T12:00:00.000Z");

  const change = {
    userId: 1,
    passwordHash: "new-hash",
    revokedAt: CHANGED_AT,
    revokedReason: "password_changed",
    exceptSessionId: 10,
    message: {
      type: "password_changed",
      recipient: "owner@example.com",
      subject: "Your password was changed",
      html: "<p>changed</p>",
      text: "changed",
    },
  } as const;

  it("stores the new hash and revokes the other sessions of that user", async () => {
    const repo = repoWithTwoUsers();

    await repo.changeUserPassword(change);

    expect(repo.authUsers.get("owner@example.com")?.passwordHash).toBe(
      "new-hash",
    );
    expect(repo.sessions.find((s) => s.id === 11)?.revokedAt).toEqual(
      CHANGED_AT,
    );
    expect(repo.sessions.find((s) => s.id === 11)?.revokedReason).toBe(
      "password_changed",
    );
  });

  it("keeps the session behind the request active", async () => {
    const repo = repoWithTwoUsers();

    await repo.changeUserPassword(change);

    expect(repo.sessions.find((s) => s.id === 10)?.revokedAt).toBeNull();
  });

  it("leaves the sessions of another user untouched", async () => {
    const repo = repoWithTwoUsers();

    await repo.changeUserPassword(change);

    expect(repo.sessions.find((s) => s.id === 12)?.revokedAt).toBeNull();
    expect(repo.authUsers.get("other@example.com")?.passwordHash).toBe(
      "other-hash",
    );
  });
});
