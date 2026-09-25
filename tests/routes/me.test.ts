import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { hashSessionToken } from "../../src/lib/token-hash.js";
import { makeAppOptions } from "../helpers/app-options.js";
import { createInMemoryStore } from "../helpers/in-memory-store.js";

const TOKEN = "a-session-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const EMAIL = "foo@gmail.com";
const DAY_MS = 24 * 60 * 60 * 1000;

function repoWithSession(createdAt = new Date(), expiresAt?: Date) {
  return createInMemoryStore({
    users: [{ id: USER_ID, email: EMAIL, passwordHash: "$argon2id$hash" }],
    sessions: [
      {
        id: SESSION_ID,
        userId: USER_ID,
        tokenHash: hashSessionToken(TOKEN),
        createdAt,
        ...(expiresAt ? { expiresAt } : {}),
      },
    ],
  });
}

async function me(
  options: Parameters<typeof makeAppOptions>[0] = {},
  cookie: string | null = TOKEN,
) {
  const app = buildApp(makeAppOptions(options));
  const response = await app.inject({
    method: "GET",
    url: "/me",
    ...(cookie ? { cookies: { session: cookie } } : {}),
  });
  await app.close();
  return response;
}

describe("GET /me", () => {
  it("returns the public data of the user behind the session cookie", async () => {
    const response = await me({ store: repoWithSession() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: { id: USER_ID, email: EMAIL } });
  });

  it("returns a generic 401 without a session cookie", async () => {
    const response = await me({}, null);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
  });

  it("returns the same generic 401 for a session that was signed out", async () => {
    const store = repoWithSession();
    store.sessions.delete(SESSION_ID);

    const response = await me({ store });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
  });

  it("returns the same generic 401 for a session older than the default ttl", async () => {
    const response = await me({
      store: repoWithSession(new Date(Date.now() - 30 * DAY_MS)),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
  });

  it("trusts the stored expiry over the configured session ttl", async () => {
    const createdAt = new Date(Date.now() - 2 * 60 * 1000);

    // Issued under a one-minute TTL: raising the TTL later must not revive it.
    const expired = await me({
      store: repoWithSession(createdAt, new Date(Date.now() - 60 * 1000)),
      ttl: { sessionSeconds: 30 * 24 * 60 * 60 },
    });
    // Issued under a longer TTL: lowering it later must not cut it short.
    const live = await me({
      store: repoWithSession(createdAt, new Date(Date.now() + 60 * 1000)),
      ttl: { sessionSeconds: 60 },
    });

    expect(expired.statusCode).toBe(401);
    expect(expired.json()).toEqual({ message: "Unauthorized." });
    expect(live.statusCode).toBe(200);
  });

  it("fails loudly when the session is valid but the user is gone", async () => {
    const store = createInMemoryStore({
      sessions: [
        {
          userId: "44444444-4444-4444-8444-444444444444",
          tokenHash: hashSessionToken(TOKEN),
        },
      ],
    });

    const response = await me({ store });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ message: "Internal Server Error" });
  });

  it("never exposes the password hash nor the verification state", async () => {
    const response = await me({ store: repoWithSession() });

    expect(response.body).not.toContain("argon2");
    expect(Object.keys(response.json().user)).toEqual(["id", "email"]);
  });
});
