import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { hashSessionToken } from "../../src/lib/token-hash.js";
import { makeAppOptions } from "../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../helpers/auth/in-memory-repository.js";

const TOKEN = "a-session-token";
const OTHER_TOKEN = "another-session-token";
const CURRENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const FUTURE = new Date(Date.now() + 60_000);

function repoWithTwoSessions() {
  return createInMemoryAuthRepository({
    authUsers: [{ id: 7, email: "foo@gmail.com" }],
    sessions: [
      {
        userId: 7,
        tokenHash: hashSessionToken(TOKEN),
        publicId: CURRENT_ID,
        deviceLabel: "Mozilla/5.0 (Macintosh)",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: FUTURE,
      },
      {
        userId: 7,
        tokenHash: hashSessionToken(OTHER_TOKEN),
        publicId: OTHER_ID,
        deviceLabel: null,
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
        expiresAt: FUTURE,
      },
    ],
  });
}

describe("GET /sessions", () => {
  it("lists the active sessions newest first and flags the current one", async () => {
    const app = buildApp(
      makeAppOptions({ authRepository: repoWithTwoSessions() }),
    );
    const response = await app.inject({
      method: "GET",
      url: "/sessions",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(200);
    const { sessions } = response.json();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      id: OTHER_ID,
      deviceLabel: null,
      isCurrent: false,
    });
    expect(sessions[1]).toMatchObject({
      id: CURRENT_ID,
      deviceLabel: "Mozilla/5.0 (Macintosh)",
      isCurrent: true,
    });
    expect(sessions[1].createdAt).toBe("2026-01-01T00:00:00.000Z");
    await app.close();
  });

  it("never exposes the token hash", async () => {
    const app = buildApp(
      makeAppOptions({ authRepository: repoWithTwoSessions() }),
    );
    const response = await app.inject({
      method: "GET",
      url: "/sessions",
      cookies: { session: TOKEN },
    });

    expect(response.body).not.toContain(hashSessionToken(TOKEN));
    await app.close();
  });

  it("never lists a session belonging to another user", async () => {
    const authRepository = createInMemoryAuthRepository({
      authUsers: [{ id: 7, email: "foo@gmail.com" }],
      sessions: [
        {
          userId: 7,
          tokenHash: hashSessionToken(TOKEN),
          publicId: CURRENT_ID,
          expiresAt: FUTURE,
        },
        {
          userId: 8,
          tokenHash: "someone-else",
          expiresAt: FUTURE,
        },
      ],
    });
    const app = buildApp(makeAppOptions({ authRepository }));
    const response = await app.inject({
      method: "GET",
      url: "/sessions",
      cookies: { session: TOKEN },
    });

    expect(response.json().sessions).toHaveLength(1);
    expect(response.json().sessions[0].id).toBe(CURRENT_ID);
    await app.close();
  });

  it("returns a generic 401 without a session cookie", async () => {
    const app = buildApp(makeAppOptions());
    const response = await app.inject({ method: "GET", url: "/sessions" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
    await app.close();
  });

  it("returns the same generic 401 for an unknown session cookie", async () => {
    const app = buildApp(
      makeAppOptions({ authRepository: repoWithTwoSessions() }),
    );
    const response = await app.inject({
      method: "GET",
      url: "/sessions",
      cookies: { session: "a-token-no-session-was-ever-created-for" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
    await app.close();
  });

  it("returns the same generic 401 for a revoked session", async () => {
    const authRepository = createInMemoryAuthRepository({
      authUsers: [{ id: 7, email: "foo@gmail.com" }],
      sessions: [
        {
          userId: 7,
          tokenHash: hashSessionToken(TOKEN),
          expiresAt: FUTURE,
          revokedAt: new Date(),
        },
      ],
    });
    const app = buildApp(makeAppOptions({ authRepository }));
    const response = await app.inject({
      method: "GET",
      url: "/sessions",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
    await app.close();
  });

  it("returns the same generic 401 for an expired session", async () => {
    const authRepository = createInMemoryAuthRepository({
      authUsers: [{ id: 7, email: "foo@gmail.com" }],
      sessions: [
        {
          userId: 7,
          tokenHash: hashSessionToken(TOKEN),
          expiresAt: new Date(Date.now() - 1),
        },
      ],
    });
    const app = buildApp(makeAppOptions({ authRepository }));
    const response = await app.inject({
      method: "GET",
      url: "/sessions",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
    await app.close();
  });
});
