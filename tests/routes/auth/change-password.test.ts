import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashPassword } from "../../../src/lib/password.js";
import { hashSessionToken } from "../../../src/lib/token-hash.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryStore } from "../../helpers/in-memory-store.js";

const TOKEN = "current-session-token";
const OTHER_TOKEN = "laptop-session-token";
const CURRENT = "current-password-here";
const NEXT = "a-brand-new-long-password";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CURRENT_SESSION_ID = "10101010-1010-4010-8010-101010101010";
const OTHER_SESSION_ID = "11111111-1111-4111-8111-111111111112";

async function repoWithTwoSessions() {
  return createInMemoryStore({
    users: [
      {
        id: USER_ID,
        email: "owner@example.com",
        passwordHash: await hashPassword(CURRENT),
      },
    ],
    sessions: [
      {
        id: CURRENT_SESSION_ID,
        userId: USER_ID,
        tokenHash: hashSessionToken(TOKEN),
      },
      {
        id: OTHER_SESSION_ID,
        userId: USER_ID,
        tokenHash: hashSessionToken(OTHER_TOKEN),
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
    const store = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));
    const before = store.users.get(USER_ID)?.passwordHash;

    const response = await app.inject(
      change({ currentPassword: CURRENT, newPassword: NEXT }),
    );

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(store.users.get(USER_ID)?.passwordHash).not.toBe(before);
    await app.close();
  });

  it("deletes the other session and keeps the current one", async () => {
    const store = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));

    await app.inject(change({ currentPassword: CURRENT, newPassword: NEXT }));

    expect([...store.sessions.keys()]).toEqual([CURRENT_SESSION_ID]);
    await app.close();
  });

  it("never touches the session cookie", async () => {
    const store = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));

    const response = await app.inject(
      change({ currentPassword: CURRENT, newPassword: NEXT }),
    );

    expect(response.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });

  it("lets the caller keep using the session afterwards", async () => {
    const store = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));

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
    const store = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));
    const before = store.users.get(USER_ID)?.passwordHash;

    const response = await app.inject(
      change({ currentPassword: "not-the-password", newPassword: NEXT }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe("The current password is incorrect.");
    expect(store.users.get(USER_ID)?.passwordHash).toBe(before);
    expect(store.sessions.size).toBe(2);
    await app.close();
  });

  it("responds 400 when the new password equals the current one", async () => {
    const store = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));

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
    const store = await repoWithTwoSessions();
    const app = buildApp(
      makeAppOptions({
        store,
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
    const store = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));

    const response = await app.inject(
      change({ currentPassword: CURRENT, newPassword: "short" }),
    );

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("responds 401 without a session cookie", async () => {
    const store = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));

    const response = await app.inject({
      method: "POST",
      url: "/auth/change-password",
      payload: { currentPassword: CURRENT, newPassword: NEXT },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
    await app.close();
  });

  it("responds 401 with the cookie of a session that was signed out", async () => {
    const store = await repoWithTwoSessions();
    store.sessions.delete(CURRENT_SESSION_ID);
    const app = buildApp(makeAppOptions({ store }));

    const response = await app.inject(
      change({ currentPassword: CURRENT, newPassword: NEXT }),
    );

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("never exposes a password hash in the response", async () => {
    const store = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));

    const response = await app.inject(
      change({ currentPassword: "not-the-password", newPassword: NEXT }),
    );

    expect(response.body).not.toContain("$argon2");
    await app.close();
  });
});

describe("POST /auth/change-password throttling", () => {
  it("returns 429 with Retry-After once the free attempts are spent", async () => {
    const store = await repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));
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
