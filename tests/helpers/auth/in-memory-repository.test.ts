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
    expect(repo.sessions).toMatchObject([
      {
        userId: 1,
        tokenHash: "session-hash",
        deviceLabel: "Mozilla/5.0",
        expiresAt: new Date(NOW.getTime() + 1_000),
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
    expect(repo.sessions).toMatchObject([
      { userId: 7, tokenHash: "t", deviceLabel: null, expiresAt: NOW },
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
