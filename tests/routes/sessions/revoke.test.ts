import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashSessionToken } from "../../../src/lib/token-hash.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/auth/in-memory-repository.js";

const TOKEN = "a-session-token";
const OTHER_TOKEN = "another-session-token";
const CURRENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";
const FUTURE = new Date(Date.now() + 60_000);

function repoWithTwoSessions() {
  return createInMemoryAuthRepository({
    authUsers: [{ id: 7, email: "foo@gmail.com" }],
    sessions: [
      {
        userId: 7,
        tokenHash: hashSessionToken(TOKEN),
        publicId: CURRENT_ID,
        expiresAt: FUTURE,
      },
      {
        userId: 7,
        tokenHash: hashSessionToken(OTHER_TOKEN),
        publicId: OTHER_ID,
        expiresAt: FUTURE,
      },
    ],
  });
}

describe("DELETE /sessions/:sessionId", () => {
  it("revokes the session named in the path", async () => {
    const authRepository = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject({
      method: "DELETE",
      url: `/sessions/${OTHER_ID}`,
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    const revoked = authRepository.sessions.find(
      (s) => s.publicId === OTHER_ID,
    );
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    expect(revoked?.revokedReason).toBe("session_revoked");
    await app.close();
  });

  it("keeps the caller signed in and never clears the cookie", async () => {
    const app = buildApp(
      makeAppOptions({ authRepository: repoWithTwoSessions() }),
    );

    const response = await app.inject({
      method: "DELETE",
      url: `/sessions/${OTHER_ID}`,
      cookies: { session: TOKEN },
    });

    expect(response.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });

  it("answers the same 204 for a session id that does not exist", async () => {
    const app = buildApp(
      makeAppOptions({ authRepository: repoWithTwoSessions() }),
    );

    const response = await app.inject({
      method: "DELETE",
      url: `/sessions/${UNKNOWN_ID}`,
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    await app.close();
  });

  it("answers the same 204 for a session belonging to another user, without revoking it", async () => {
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
          publicId: OTHER_ID,
          expiresAt: FUTURE,
        },
      ],
    });
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject({
      method: "DELETE",
      url: `/sessions/${OTHER_ID}`,
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    expect(
      authRepository.sessions.find((s) => s.publicId === OTHER_ID)?.revokedAt,
    ).toBeNull();
    await app.close();
  });

  it("answers 204 again when the session was already revoked", async () => {
    const authRepository = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    await app.inject({
      method: "DELETE",
      url: `/sessions/${OTHER_ID}`,
      cookies: { session: TOKEN },
    });
    const first = authRepository.sessions.find(
      (s) => s.publicId === OTHER_ID,
    )?.revokedAt;

    const response = await app.inject({
      method: "DELETE",
      url: `/sessions/${OTHER_ID}`,
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    expect(
      authRepository.sessions.find((s) => s.publicId === OTHER_ID)?.revokedAt,
    ).toEqual(first);
    await app.close();
  });

  it("revokes the current session when its own id is sent, without any special case", async () => {
    const authRepository = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject({
      method: "DELETE",
      url: `/sessions/${CURRENT_ID}`,
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    expect(
      authRepository.sessions.find((s) => s.publicId === CURRENT_ID)?.revokedAt,
    ).toBeInstanceOf(Date);
    await app.close();
  });

  it("rejects a session id that is not a uuid with a 400, before touching the store", async () => {
    const app = buildApp(
      makeAppOptions({ authRepository: repoWithTwoSessions() }),
    );

    const response = await app.inject({
      method: "DELETE",
      url: "/sessions/not-a-uuid",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("returns a generic 401 without a session cookie", async () => {
    const app = buildApp(makeAppOptions());

    const response = await app.inject({
      method: "DELETE",
      url: `/sessions/${OTHER_ID}`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
    await app.close();
  });

  it("returns the same generic 401 for an expired session cookie", async () => {
    const authRepository = createInMemoryAuthRepository({
      authUsers: [{ id: 7, email: "foo@gmail.com" }],
      sessions: [
        {
          userId: 7,
          tokenHash: hashSessionToken(TOKEN),
          publicId: CURRENT_ID,
          expiresAt: new Date(Date.now() - 1),
        },
      ],
    });
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject({
      method: "DELETE",
      url: `/sessions/${OTHER_ID}`,
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
    await app.close();
  });

  it("never exposes a token hash in the response", async () => {
    const app = buildApp(
      makeAppOptions({ authRepository: repoWithTwoSessions() }),
    );

    const response = await app.inject({
      method: "DELETE",
      url: `/sessions/${OTHER_ID}`,
      cookies: { session: TOKEN },
    });

    expect(response.body).not.toContain(hashSessionToken(OTHER_TOKEN));
    await app.close();
  });
});
