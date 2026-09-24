import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashPassword } from "../../../src/lib/password.js";
import { hashSessionToken } from "../../../src/lib/token-hash.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/auth/in-memory-repository.js";

const TOKEN = "current-session-token";
const OTHER_TOKEN = "laptop-session-token";
const CURRENT = "current-password-here";
const NEXT = "a-brand-new-long-password";
const FUTURE = new Date(Date.now() + 60_000);

async function repoWithTwoSessions() {
  return createInMemoryAuthRepository({
    authUsers: [
      {
        id: 1,
        email: "owner@example.com",
        passwordHash: await hashPassword(CURRENT),
      },
    ],
    sessions: [
      {
        id: 10,
        userId: 1,
        tokenHash: hashSessionToken(TOKEN),
        expiresAt: FUTURE,
      },
      {
        id: 11,
        userId: 1,
        tokenHash: hashSessionToken(OTHER_TOKEN),
        expiresAt: FUTURE,
      },
    ],
  });
}

function change(body: Record<string, string>) {
  return {
    method: "POST" as const,
    url: "/auth/change-password",
    cookies: { session: TOKEN },
    payload: body,
  };
}

describe("POST /auth/change-password", () => {
  it("responds 204 and stores a different hash", async () => {
    const authRepository = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));
    const before =
      authRepository.authUsers.get("owner@example.com")?.passwordHash;

    const response = await app.inject(
      change({ currentPassword: CURRENT, newPassword: NEXT }),
    );

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(
      authRepository.authUsers.get("owner@example.com")?.passwordHash,
    ).not.toBe(before);
    await app.close();
  });

  it("revokes the other session and keeps the current one", async () => {
    const authRepository = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    await app.inject(change({ currentPassword: CURRENT, newPassword: NEXT }));

    expect(
      authRepository.sessions.find((s) => s.id === 11)?.revokedAt,
    ).not.toBeNull();
    expect(
      authRepository.sessions.find((s) => s.id === 11)?.revokedReason,
    ).toBe("password_changed");
    expect(
      authRepository.sessions.find((s) => s.id === 10)?.revokedAt,
    ).toBeNull();
    await app.close();
  });

  it("never touches the session cookie", async () => {
    const authRepository = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject(
      change({ currentPassword: CURRENT, newPassword: NEXT }),
    );

    expect(response.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });

  it("lets the caller keep using the session afterwards", async () => {
    const authRepository = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    await app.inject(change({ currentPassword: CURRENT, newPassword: NEXT }));
    const after = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session: TOKEN },
    });

    expect(after.statusCode).toBe(200);
    await app.close();
  });

  it("responds 400 when the current password is wrong", async () => {
    const authRepository = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));
    const before =
      authRepository.authUsers.get("owner@example.com")?.passwordHash;

    const response = await app.inject(
      change({ currentPassword: "not-the-password", newPassword: NEXT }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe("The current password is incorrect.");
    expect(
      authRepository.authUsers.get("owner@example.com")?.passwordHash,
    ).toBe(before);
    await app.close();
  });

  it("responds 400 when the new password equals the current one", async () => {
    const authRepository = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject(
      change({ currentPassword: CURRENT, newPassword: CURRENT }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe(
      "The new password must be different from the current one.",
    );
    await app.close();
  });

  it("responds 400 when the new password appeared in a breach", async () => {
    const authRepository = await repoWithTwoSessions();
    const app = buildApp(
      makeAppOptions({
        authRepository,
        checkPwnedPassword: async () => true,
      }),
    );

    const response = await app.inject(
      change({ currentPassword: CURRENT, newPassword: NEXT }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe(
      "This password has appeared in a known data breach. Please choose a different one.",
    );
    await app.close();
  });

  it("responds 400 when the new password is too short", async () => {
    const authRepository = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject(
      change({ currentPassword: CURRENT, newPassword: "short" }),
    );

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("responds 401 without a session cookie", async () => {
    const authRepository = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject({
      method: "POST",
      url: "/auth/change-password",
      payload: { currentPassword: CURRENT, newPassword: NEXT },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
    await app.close();
  });

  it("responds 401 with a revoked session cookie", async () => {
    const authRepository = await repoWithTwoSessions();
    const session = authRepository.sessions.find((s) => s.id === 10);
    if (session) {
      session.revokedAt = new Date();
    }
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject(
      change({ currentPassword: CURRENT, newPassword: NEXT }),
    );

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("never exposes a password hash in the response", async () => {
    const authRepository = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject(
      change({ currentPassword: "not-the-password", newPassword: NEXT }),
    );

    expect(response.body).not.toContain("$argon2");
    await app.close();
  });
});

describe("POST /auth/change-password throttling", () => {
  it("returns 429 with Retry-After once the free attempts are spent", async () => {
    const authRepository = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));
    const attempt = () =>
      app.inject(
        change({
          currentPassword: "wrong-password-wrong-password",
          newPassword: "another-correct-horse-battery",
        }),
      );

    for (let i = 0; i < 4; i += 1) {
      await attempt();
    }
    const response = await attempt();

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      message: "Too many attempts. Try again later.",
    });
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
    await app.close();
  });
});
