import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashSessionToken } from "../../../src/lib/token-hash.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/auth/in-memory-repository.js";

const TOKEN = "a-session-token";
const OTHER_TOKEN = "another-session-token";
const THIRD_TOKEN = "a-third-session-token";
const USER_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_USER_ID = "88888888-8888-4888-8888-888888888888";
const CURRENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const THIRD_ID = "33333333-3333-4333-8333-333333333333";
const EXPIRED_CREATED_AT = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

function repoWithThreeSessions() {
  return createInMemoryAuthRepository({
    users: [{ id: USER_ID, email: "foo@gmail.com" }],
    sessions: [
      { id: CURRENT_ID, userId: USER_ID, tokenHash: hashSessionToken(TOKEN) },
      {
        id: OTHER_ID,
        userId: USER_ID,
        tokenHash: hashSessionToken(OTHER_TOKEN),
      },
      {
        id: THIRD_ID,
        userId: USER_ID,
        tokenHash: hashSessionToken(THIRD_TOKEN),
      },
    ],
  });
}

describe("DELETE /sessions", () => {
  it("deletes the other sessions and keeps the current one", async () => {
    const authRepository = repoWithThreeSessions();
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject({
      method: "DELETE",
      url: "/sessions",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    expect([...authRepository.sessions.keys()]).toEqual([CURRENT_ID]);
    await app.close();
  });

  it("never clears the cookie, because the current session always survives", async () => {
    const app = buildApp(
      makeAppOptions({ authRepository: repoWithThreeSessions() }),
    );

    const response = await app.inject({
      method: "DELETE",
      url: "/sessions",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });

  it("answers 204 for a user whose only session is the current one", async () => {
    const authRepository = createInMemoryAuthRepository({
      users: [{ id: USER_ID, email: "foo@gmail.com" }],
      sessions: [
        { id: CURRENT_ID, userId: USER_ID, tokenHash: hashSessionToken(TOKEN) },
      ],
    });
    const app = buildApp(makeAppOptions({ authRepository }));

    const response = await app.inject({
      method: "DELETE",
      url: "/sessions",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    expect([...authRepository.sessions.keys()]).toEqual([CURRENT_ID]);
    await app.close();
  });

  it("never touches the sessions of another user", async () => {
    const authRepository = createInMemoryAuthRepository({
      users: [
        { id: USER_ID, email: "foo@gmail.com" },
        { id: OTHER_USER_ID, email: "bar@gmail.com" },
      ],
      sessions: [
        { id: CURRENT_ID, userId: USER_ID, tokenHash: hashSessionToken(TOKEN) },
        {
          id: OTHER_ID,
          userId: OTHER_USER_ID,
          tokenHash: hashSessionToken(OTHER_TOKEN),
        },
      ],
    });
    const app = buildApp(makeAppOptions({ authRepository }));

    await app.inject({
      method: "DELETE",
      url: "/sessions",
      cookies: { session: TOKEN },
    });

    expect(authRepository.sessions.has(OTHER_ID)).toBe(true);
    await app.close();
  });

  const REFUSALS: Array<{
    name: string;
    cookie?: string;
    createdAt?: Date;
  }> = [
    { name: "the cookie is missing" },
    { name: "the token is unknown", cookie: "not-a-real-token" },
    {
      name: "the session is expired",
      cookie: TOKEN,
      createdAt: EXPIRED_CREATED_AT,
    },
  ];

  it.each(REFUSALS)(
    "answers a generic 401 without deleting anything when $name",
    async ({ cookie, createdAt }) => {
      const authRepository = createInMemoryAuthRepository({
        users: [{ id: USER_ID, email: "foo@gmail.com" }],
        sessions: [
          {
            id: CURRENT_ID,
            userId: USER_ID,
            tokenHash: hashSessionToken(TOKEN),
            createdAt: createdAt ?? new Date(),
          },
          {
            id: OTHER_ID,
            userId: USER_ID,
            tokenHash: hashSessionToken(OTHER_TOKEN),
          },
        ],
      });
      const app = buildApp(makeAppOptions({ authRepository }));

      const response = await app.inject({
        method: "DELETE",
        url: "/sessions",
        ...(cookie ? { cookies: { session: cookie } } : {}),
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ message: "Unauthorized." });
      expect(authRepository.sessions.size).toBe(2);
      await app.close();
    },
  );

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
