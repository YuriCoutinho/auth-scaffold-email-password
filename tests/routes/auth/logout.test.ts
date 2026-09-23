import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashSessionToken } from "../../../src/lib/token-hash.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/auth/in-memory-repository.js";

const TOKEN = "a-session-token";
const OTHER_TOKEN = "another-session-token";

function repoWithTwoSessions() {
  const expiresAt = new Date(Date.now() + 60_000);
  return createInMemoryAuthRepository({
    authUsers: [{ id: 7, email: "foo@gmail.com" }],
    sessions: [
      { id: 1, userId: 7, tokenHash: hashSessionToken(TOKEN), expiresAt },
      { id: 2, userId: 7, tokenHash: hashSessionToken(OTHER_TOKEN), expiresAt },
    ],
  });
}

function sessionCookie(response: { headers: Record<string, unknown> }) {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : [header];
  return values.find((value) => String(value).startsWith("session="));
}

describe("POST /auth/logout", () => {
  it("revokes the session of the cookie and answers 204", async () => {
    const authRepository = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    expect(authRepository.sessions[0]).toMatchObject({
      revokedReason: "user_logout",
    });
    expect(authRepository.sessions[0]?.revokedAt).toBeInstanceOf(Date);
    await app.close();
  });

  it("leaves the other sessions of the same user untouched", async () => {
    const authRepository = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { session: TOKEN },
    });

    expect(authRepository.sessions[1]).toMatchObject({
      revokedAt: null,
      revokedReason: null,
    });
    await app.close();
  });

  it("clears the session cookie with the hardened flags", async () => {
    const app = buildApp(
      makeAppOptions({ authRepository: repoWithTwoSessions() }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { session: TOKEN },
    });

    const cookie = String(sessionCookie(response));
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    await app.close();
  });

  it("answers 204 and still clears the cookie without a session cookie", async () => {
    const app = buildApp(makeAppOptions());

    const response = await app.inject({ method: "POST", url: "/auth/logout" });

    expect(response.statusCode).toBe(204);
    expect(String(sessionCookie(response))).toContain("Max-Age=0");
    await app.close();
  });

  it("answers 204 for a session that was already revoked", async () => {
    const authRepository = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { session: TOKEN },
    });
    const first = authRepository.sessions[0]?.revokedAt;

    const response = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    expect(authRepository.sessions[0]?.revokedAt).toBe(first);
    await app.close();
  });

  it("answers 204 for an unknown token", async () => {
    const app = buildApp(
      makeAppOptions({ authRepository: repoWithTwoSessions() }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { session: "unknown-token" },
    });

    expect(response.statusCode).toBe(204);
    await app.close();
  });
});
