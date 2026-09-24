import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashSessionToken } from "../../../src/lib/token-hash.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/auth/in-memory-repository.js";

const TOKEN = "a-session-token";
const OTHER_TOKEN = "another-session-token";
const USER_ID = "77777777-7777-4777-8777-777777777777";
const CURRENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function repoWithTwoSessions() {
  return createInMemoryAuthRepository({
    users: [{ id: USER_ID, email: "foo@gmail.com" }],
    sessions: [
      { id: CURRENT_ID, userId: USER_ID, tokenHash: hashSessionToken(TOKEN) },
      {
        id: OTHER_ID,
        userId: USER_ID,
        tokenHash: hashSessionToken(OTHER_TOKEN),
      },
    ],
  });
}

function sessionCookie(response: { headers: Record<string, unknown> }) {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : [header];
  return values.find((value) => String(value).startsWith("session="));
}

describe("DELETE /sessions/current", () => {
  it("deletes the session of the cookie and answers 204", async () => {
    const authRepository = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject({
      method: "DELETE",
      url: "/sessions/current",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    expect(authRepository.sessions.has(CURRENT_ID)).toBe(false);
    await app.close();
  });

  it("leaves the other sessions of the same user untouched", async () => {
    const authRepository = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    await app.inject({
      method: "DELETE",
      url: "/sessions/current",
      cookies: { session: TOKEN },
    });

    expect([...authRepository.sessions.keys()]).toEqual([OTHER_ID]);
    await app.close();
  });

  it("makes the cookie useless afterwards, so GET /me answers 401", async () => {
    const app = buildApp(
      makeAppOptions({ authRepository: repoWithTwoSessions() }),
    );

    await app.inject({
      method: "DELETE",
      url: "/sessions/current",
      cookies: { session: TOKEN },
    });
    const me = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session: TOKEN },
    });

    expect(me.statusCode).toBe(401);
    expect(me.json()).toEqual({ message: "Unauthorized." });
    await app.close();
  });

  it("clears the session cookie with the hardened flags", async () => {
    const app = buildApp(
      makeAppOptions({ authRepository: repoWithTwoSessions() }),
    );

    const response = await app.inject({
      method: "DELETE",
      url: "/sessions/current",
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

    const response = await app.inject({
      method: "DELETE",
      url: "/sessions/current",
    });

    expect(response.statusCode).toBe(204);
    expect(String(sessionCookie(response))).toContain("Max-Age=0");
    await app.close();
  });

  it("answers 204 for a session that was already signed out", async () => {
    const authRepository = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    await app.inject({
      method: "DELETE",
      url: "/sessions/current",
      cookies: { session: TOKEN },
    });
    const response = await app.inject({
      method: "DELETE",
      url: "/sessions/current",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    expect([...authRepository.sessions.keys()]).toEqual([OTHER_ID]);
    await app.close();
  });

  it("answers 204 for an unknown token without deleting anything", async () => {
    const authRepository = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject({
      method: "DELETE",
      url: "/sessions/current",
      cookies: { session: "unknown-token" },
    });

    expect(response.statusCode).toBe(204);
    expect(authRepository.sessions.size).toBe(2);
    await app.close();
  });

  it("no longer answers on the old address", async () => {
    const app = buildApp(makeAppOptions());

    const response = await app.inject({ method: "POST", url: "/auth/logout" });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
