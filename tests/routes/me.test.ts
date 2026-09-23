import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { hashSessionToken } from "../../src/lib/token-hash.js";
import { makeAppOptions } from "../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../helpers/auth/in-memory-repository.js";

const TOKEN = "a-session-token";
const PUBLIC_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "foo@gmail.com";

function repoWithSession(
  overrides: { expiresAt?: Date; revokedAt?: Date } = {},
) {
  return createInMemoryAuthRepository({
    authUsers: [{ id: 7, email: EMAIL, publicId: PUBLIC_ID }],
    sessions: [
      {
        userId: 7,
        tokenHash: hashSessionToken(TOKEN),
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
        revokedAt: overrides.revokedAt ?? null,
      },
    ],
  });
}

describe("GET /me", () => {
  it("returns the public data of the user behind the session cookie", async () => {
    const app = buildApp(makeAppOptions({ authRepository: repoWithSession() }));
    const response = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: { publicId: PUBLIC_ID, email: EMAIL },
    });
    await app.close();
  });

  it("returns a generic 401 without a session cookie", async () => {
    const app = buildApp(makeAppOptions());
    const response = await app.inject({ method: "GET", url: "/me" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
    await app.close();
  });

  it("returns the same generic 401 for a revoked session", async () => {
    const authRepository = repoWithSession({ revokedAt: new Date() });
    const app = buildApp(makeAppOptions({ authRepository }));
    const response = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
    await app.close();
  });

  it("returns the same generic 401 for an expired session", async () => {
    const authRepository = repoWithSession({
      expiresAt: new Date(Date.now() - 1000),
    });
    const app = buildApp(makeAppOptions({ authRepository }));
    const response = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("fails loudly when the session is valid but the user is gone", async () => {
    const authRepository = createInMemoryAuthRepository({
      sessions: [
        {
          userId: 404,
          tokenHash: hashSessionToken(TOKEN),
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });
    const app = buildApp(makeAppOptions({ authRepository }));
    const response = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ message: "Internal Server Error" });
    await app.close();
  });

  it("never exposes the internal user id", async () => {
    const app = buildApp(makeAppOptions({ authRepository: repoWithSession() }));
    const response = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session: TOKEN },
    });

    expect(response.body).not.toContain('"id"');
    await app.close();
  });
});
