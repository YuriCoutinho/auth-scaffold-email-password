import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashSessionToken } from "../../../src/lib/token-hash.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/auth/in-memory-repository.js";

const TOKEN = "a-session-token";
const OTHER_TOKEN = "another-session-token";
const THIRD_TOKEN = "a-third-session-token";

function repoWithThreeSessions() {
  const expiresAt = new Date(Date.now() + 60_000);
  return createInMemoryAuthRepository({
    authUsers: [{ id: 7, email: "foo@gmail.com" }],
    sessions: [
      { id: 1, userId: 7, tokenHash: hashSessionToken(TOKEN), expiresAt },
      { id: 2, userId: 7, tokenHash: hashSessionToken(OTHER_TOKEN), expiresAt },
      { id: 3, userId: 7, tokenHash: hashSessionToken(THIRD_TOKEN), expiresAt },
    ],
  });
}

function sessionCookie(response: { headers: Record<string, unknown> }) {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : [header];
  return values.find((value) => String(value).startsWith("session="));
}

describe("DELETE /sessions", () => {
  it("revokes the other sessions and keeps the current one", async () => {
    const authRepository = repoWithThreeSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject({
      method: "DELETE",
      url: "/sessions",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    expect(authRepository.sessions.find((s) => s.id === 1)).toMatchObject({
      revokedAt: null,
      revokedReason: null,
    });
    expect(authRepository.sessions.find((s) => s.id === 2)).toMatchObject({
      revokedReason: "logout_all",
    });
    expect(authRepository.sessions.find((s) => s.id === 3)).toMatchObject({
      revokedReason: "logout_all",
    });
    await app.close();
  });

  it("never clears the cookie when the current session survives", async () => {
    const app = buildApp(
      makeAppOptions({ authRepository: repoWithThreeSessions() }),
    );

    const response = await app.inject({
      method: "DELETE",
      url: "/sessions",
      cookies: { session: TOKEN },
      payload: { includeCurrentSession: false },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });

  it("revokes the current session too and clears the cookie when asked", async () => {
    const authRepository = repoWithThreeSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject({
      method: "DELETE",
      url: "/sessions",
      cookies: { session: TOKEN },
      payload: { includeCurrentSession: true },
    });

    expect(response.statusCode).toBe(204);
    expect(authRepository.sessions.find((s) => s.id === 1)).toMatchObject({
      revokedReason: "logout_all",
    });

    const cookie = String(sessionCookie(response));
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    await app.close();
  });

  it("answers 204 for a user whose only session is the current one", async () => {
    const authRepository = createInMemoryAuthRepository({
      authUsers: [{ id: 7, email: "foo@gmail.com" }],
      sessions: [
        {
          id: 1,
          userId: 7,
          tokenHash: hashSessionToken(TOKEN),
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject({
      method: "DELETE",
      url: "/sessions",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    await app.close();
  });

  it("never touches the sessions of another user", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const authRepository = createInMemoryAuthRepository({
      authUsers: [
        { id: 7, email: "foo@gmail.com" },
        { id: 8, email: "bar@gmail.com" },
      ],
      sessions: [
        { id: 1, userId: 7, tokenHash: hashSessionToken(TOKEN), expiresAt },
        {
          id: 2,
          userId: 8,
          tokenHash: hashSessionToken(OTHER_TOKEN),
          expiresAt,
        },
      ],
    });
    const app = buildApp(makeAppOptions({ authRepository }));

    await app.inject({
      method: "DELETE",
      url: "/sessions",
      cookies: { session: TOKEN },
      payload: { includeCurrentSession: true },
    });

    expect(authRepository.sessions.find((s) => s.id === 2)).toMatchObject({
      revokedAt: null,
      revokedReason: null,
    });
    await app.close();
  });

  const REFUSALS: Array<{
    name: string;
    cookie?: string;
    session?: { expiresAt: Date; revokedAt?: Date };
  }> = [
    { name: "the cookie is missing" },
    { name: "the token is unknown", cookie: "not-a-real-token" },
    {
      name: "the session is expired",
      cookie: TOKEN,
      session: { expiresAt: new Date(Date.now() - 60_000) },
    },
    {
      name: "the session is revoked",
      cookie: TOKEN,
      session: {
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
      },
    },
  ];

  it.each(REFUSALS)(
    "answers a generic 401 without revoking anything when $name",
    async ({ cookie, session }) => {
      const authRepository = createInMemoryAuthRepository({
        authUsers: [{ id: 7, email: "foo@gmail.com" }],
        sessions: session
          ? [
              {
                id: 1,
                userId: 7,
                tokenHash: hashSessionToken(TOKEN),
                ...session,
              },
            ]
          : [],
      });
      const app = buildApp(makeAppOptions({ authRepository }));

      const response = await app.inject({
        method: "DELETE",
        url: "/sessions",
        ...(cookie ? { cookies: { session: cookie } } : {}),
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ message: "Unauthorized." });
      await app.close();
    },
  );

  it("rejects a non-boolean flag with a 400", async () => {
    const app = buildApp(
      makeAppOptions({ authRepository: repoWithThreeSessions() }),
    );

    const response = await app.inject({
      method: "DELETE",
      url: "/sessions",
      cookies: { session: TOKEN },
      payload: { includeCurrentSession: "yes" },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("no longer answers on the old address", async () => {
    const app = buildApp(makeAppOptions());

    const response = await app.inject({
      method: "POST",
      url: "/auth/logout-all",
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
