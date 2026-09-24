import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashSessionToken } from "../../../src/lib/token-hash.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/auth/in-memory-repository.js";

const TOKEN = "a-session-token";
const OTHER_TOKEN = "another-session-token";
const USER_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_USER_ID = "88888888-8888-4888-8888-888888888888";
const CURRENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * DAY_MS;
const CURRENT_CREATED_AT = new Date(Date.now() - 2 * DAY_MS);
const OTHER_CREATED_AT = new Date(Date.now() - DAY_MS);
const EXPIRED_CREATED_AT = new Date(Date.now() - SESSION_TTL_MS - 1000);

function repoWithTwoSessions() {
  return createInMemoryAuthRepository({
    users: [{ id: USER_ID, email: "foo@gmail.com" }],
    sessions: [
      {
        id: CURRENT_ID,
        userId: USER_ID,
        tokenHash: hashSessionToken(TOKEN),
        deviceLabel: "Mozilla/5.0 (Macintosh)",
        createdAt: CURRENT_CREATED_AT,
      },
      {
        id: OTHER_ID,
        userId: USER_ID,
        tokenHash: hashSessionToken(OTHER_TOKEN),
        deviceLabel: null,
        createdAt: OTHER_CREATED_AT,
      },
    ],
  });
}

async function list(
  authRepository: ReturnType<typeof createInMemoryAuthRepository>,
  cookie: string | null = TOKEN,
) {
  const app = buildApp(makeAppOptions({ authRepository }));
  const response = await app.inject({
    method: "GET",
    url: "/sessions",
    ...(cookie ? { cookies: { session: cookie } } : {}),
  });
  await app.close();
  return response;
}

describe("GET /sessions", () => {
  it("lists the active sessions newest first and flags the current one", async () => {
    const response = await list(repoWithTwoSessions());

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
    expect(sessions[1].createdAt).toBe(CURRENT_CREATED_AT.toISOString());
    // Only the creation instant is stored; the expiry is derived from the ttl.
    expect(sessions[1].expiresAt).toBe(
      new Date(CURRENT_CREATED_AT.getTime() + SESSION_TTL_MS).toISOString(),
    );
  });

  it("leaves out an expired session of the same user", async () => {
    const authRepository = repoWithTwoSessions();
    await authRepository.createSession({
      id: "33333333-3333-4333-8333-333333333333",
      userId: USER_ID,
      tokenHash: "expired-session",
      deviceLabel: null,
      createdAt: EXPIRED_CREATED_AT,
    });

    const response = await list(authRepository);

    expect(response.json().sessions.map((s: { id: string }) => s.id)).toEqual([
      OTHER_ID,
      CURRENT_ID,
    ]);
  });

  it("never exposes the token hash", async () => {
    const response = await list(repoWithTwoSessions());

    expect(response.body).not.toContain(hashSessionToken(TOKEN));
  });

  it("never lists a session belonging to another user", async () => {
    const authRepository = createInMemoryAuthRepository({
      users: [
        { id: USER_ID, email: "foo@gmail.com" },
        { id: OTHER_USER_ID, email: "bar@gmail.com" },
      ],
      sessions: [
        {
          id: CURRENT_ID,
          userId: USER_ID,
          tokenHash: hashSessionToken(TOKEN),
        },
        { userId: OTHER_USER_ID, tokenHash: "someone-else" },
      ],
    });

    const response = await list(authRepository);

    expect(response.json().sessions).toHaveLength(1);
    expect(response.json().sessions[0].id).toBe(CURRENT_ID);
  });

  it("returns a generic 401 without a session cookie", async () => {
    const response = await list(repoWithTwoSessions(), null);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
  });

  it("returns the same generic 401 for an unknown session cookie", async () => {
    const response = await list(
      repoWithTwoSessions(),
      "a-token-no-session-was-ever-created-for",
    );

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
  });

  it("returns the same generic 401 for a session that was signed out", async () => {
    const authRepository = repoWithTwoSessions();
    authRepository.sessions.delete(CURRENT_ID);

    const response = await list(authRepository);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
  });

  it("returns the same generic 401 for an expired session", async () => {
    const authRepository = createInMemoryAuthRepository({
      users: [{ id: USER_ID, email: "foo@gmail.com" }],
      sessions: [
        {
          userId: USER_ID,
          tokenHash: hashSessionToken(TOKEN),
          createdAt: EXPIRED_CREATED_AT,
        },
      ],
    });

    const response = await list(authRepository);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
  });
});
