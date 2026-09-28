import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashSessionToken } from "../../../src/lib/token-hash.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryStore } from "../../helpers/in-memory-store.js";

const TOKEN = "a-session-token";
const OTHER_TOKEN = "another-session-token";
const USER_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_USER_ID = "88888888-8888-4888-8888-888888888888";
const CURRENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";
const EXPIRED_CREATED_AT = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

function repoWithTwoSessions(otherCreatedAt = new Date()) {
  return createInMemoryStore({
    users: [{ id: USER_ID, email: "foo@gmail.com" }],
    sessions: [
      { id: CURRENT_ID, userId: USER_ID, tokenHash: hashSessionToken(TOKEN) },
      {
        id: OTHER_ID,
        userId: USER_ID,
        tokenHash: hashSessionToken(OTHER_TOKEN),
        createdAt: otherCreatedAt,
      },
    ],
  });
}

function revoke(
  app: ReturnType<typeof buildApp>,
  sessionId: string,
  cookie: string | null = TOKEN,
) {
  return app.inject({
    method: "DELETE",
    url: `/sessions/${sessionId}`,
    ...(cookie ? { cookies: { session: cookie } } : {}),
  });
}

describe("DELETE /sessions/:sessionId", () => {
  it("deletes the session named in the path", async () => {
    const store = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));

    const response = await revoke(app, OTHER_ID);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect([...store.sessions.keys()]).toEqual([CURRENT_ID]);
    await app.close();
  });

  it("keeps the caller signed in and never clears the cookie", async () => {
    const app = buildApp(makeAppOptions({ store: repoWithTwoSessions() }));

    const response = await revoke(app, OTHER_ID);

    expect(response.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });

  it("answers the same 204 for a session id that does not exist", async () => {
    const store = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));

    const response = await revoke(app, UNKNOWN_ID);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(store.sessions.size).toBe(2);
    await app.close();
  });

  it("answers the same 204 for a session belonging to another user, without deleting it", async () => {
    const store = createInMemoryStore({
      users: [
        { id: USER_ID, email: "foo@gmail.com" },
        { id: OTHER_USER_ID, email: "bar@gmail.com" },
      ],
      sessions: [
        { id: CURRENT_ID, userId: USER_ID, tokenHash: hashSessionToken(TOKEN) },
        { id: OTHER_ID, userId: OTHER_USER_ID, tokenHash: "someone-else" },
      ],
    });
    const app = buildApp(makeAppOptions({ store }));

    const response = await revoke(app, OTHER_ID);

    expect(response.statusCode).toBe(204);
    expect(store.sessions.has(OTHER_ID)).toBe(true);
    await app.close();
  });

  it("answers 204 again when the session was already deleted", async () => {
    const store = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));

    await revoke(app, OTHER_ID);
    const response = await revoke(app, OTHER_ID);

    expect(response.statusCode).toBe(204);
    expect([...store.sessions.keys()]).toEqual([CURRENT_ID]);
    await app.close();
  });

  it("answers 204 for a session that already expired and removes it", async () => {
    const store = repoWithTwoSessions(EXPIRED_CREATED_AT);
    const app = buildApp(makeAppOptions({ store }));

    const response = await revoke(app, OTHER_ID);

    expect(response.statusCode).toBe(204);
    expect([...store.sessions.keys()]).toEqual([CURRENT_ID]);
    await app.close();
  });

  it("deletes the current session when its own id is sent, without any special case", async () => {
    const store = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));

    const response = await revoke(app, CURRENT_ID);

    expect(response.statusCode).toBe(204);
    expect(store.sessions.has(CURRENT_ID)).toBe(false);
    await app.close();
  });

  it("rejects a session id that is not a uuid with a 400, before touching the store", async () => {
    const store = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));

    const response = await revoke(app, "not-a-uuid");

    expect(response.statusCode).toBe(400);
    expect(store.sessions.size).toBe(2);
    await app.close();
  });

  it("returns a generic 401 without a session cookie", async () => {
    const store = repoWithTwoSessions();
    const app = buildApp(makeAppOptions({ store }));

    const response = await revoke(app, OTHER_ID, null);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
    expect(store.sessions.size).toBe(2);
    await app.close();
  });

  it("returns the same generic 401 for an expired session cookie", async () => {
    const store = createInMemoryStore({
      users: [{ id: USER_ID, email: "foo@gmail.com" }],
      sessions: [
        {
          id: CURRENT_ID,
          userId: USER_ID,
          tokenHash: hashSessionToken(TOKEN),
          createdAt: EXPIRED_CREATED_AT,
        },
        {
          id: OTHER_ID,
          userId: USER_ID,
          tokenHash: hashSessionToken(OTHER_TOKEN),
        },
      ],
    });
    const app = buildApp(makeAppOptions({ store }));

    const response = await revoke(app, OTHER_ID);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
    expect(store.sessions.has(OTHER_ID)).toBe(true);
    await app.close();
  });

  it("never exposes a token hash in the response", async () => {
    const app = buildApp(makeAppOptions({ store: repoWithTwoSessions() }));

    const response = await revoke(app, OTHER_ID);

    expect(response.body).not.toContain(hashSessionToken(OTHER_TOKEN));
    await app.close();
  });
});
