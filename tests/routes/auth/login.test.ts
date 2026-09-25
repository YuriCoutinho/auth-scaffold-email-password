import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashPassword } from "../../../src/lib/password.js";
import { hashSessionToken } from "../../../src/lib/token-hash.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryStore } from "../../helpers/in-memory-store.js";

const EMAIL = "foo@gmail.com";
const PASSWORD = "correct-horse-battery-staple";
const USER_ID = "11111111-1111-4111-8111-111111111111";
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

function repoWithUser(emailVerifiedAt: Date | null = new Date(0)) {
  return createInMemoryStore({
    users: [{ id: USER_ID, email: EMAIL, passwordHash, emailVerifiedAt }],
  });
}

describe("POST /auth/login", () => {
  it("returns 204 with only the session cookie", async () => {
    const store = repoWithUser();
    const app = buildApp(makeAppOptions({ store }));
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "Foo@GMAIL.com", password: PASSWORD },
      headers: { "user-agent": "Mozilla/5.0" },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");

    const cookie = response.cookies.find((c) => c.name === "session");
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/",
      maxAge: 2_592_000,
    });

    const sessions = [...store.sessions.values()];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      userId: USER_ID,
      deviceLabel: "Mozilla/5.0",
      tokenHash: hashSessionToken(cookie?.value ?? ""),
    });
    expect(sessions[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessions[0]?.tokenHash).not.toBe(cookie?.value);
    await app.close();
  });

  it("follows a configured session ttl in the cookie maxAge", async () => {
    const app = buildApp(
      makeAppOptions({
        store: repoWithUser(),
        ttl: { sessionSeconds: 3600 },
      }),
    );
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });

    expect(response.statusCode).toBe(204);
    expect(response.cookies.find((c) => c.name === "session")?.maxAge).toBe(
      3600,
    );
    await app.close();
  });

  it("returns the same generic 401 for an account whose email was never confirmed", async () => {
    const store = repoWithUser(null);
    const app = buildApp(makeAppOptions({ store }));
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid credentials." });
    expect(response.cookies).toEqual([]);
    expect(store.sessions.size).toBe(0);
    await app.close();
  });

  it("returns a generic 401 when the email is not registered", async () => {
    const app = buildApp(makeAppOptions());
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid credentials." });
    expect(response.cookies).toEqual([]);
    await app.close();
  });

  it("returns the same generic 401 on a wrong password", async () => {
    const store = repoWithUser();
    const app = buildApp(makeAppOptions({ store }));
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: "wrong-password-entirely" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid credentials." });
    expect(store.sessions.size).toBe(0);
    await app.close();
  });

  it("returns 400 on invalid body", async () => {
    const app = buildApp(makeAppOptions());
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "not-an-email", password: "" },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe("POST /auth/login throttling", () => {
  it("returns 429 with Retry-After once the free attempts are spent", async () => {
    const store = repoWithUser();
    const credentialThrottleRepository = createInMemoryStore().legacy;
    const app = buildApp(
      makeAppOptions({ store, credentialThrottleRepository }),
    );
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: EMAIL, password: "wrong-password-wrong-password" },
      });

    for (let i = 0; i < 4; i += 1) {
      await attempt();
    }
    const response = await attempt();

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      message: "Too many attempts. Try again later.",
    });
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
    await app.close();
  });

  it("blocks an unknown email the same way, so the block reveals nothing", async () => {
    const app = buildApp(makeAppOptions());
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: "nobody@gmail.com",
          password: "wrong-password-wrong-password",
        },
      });

    for (let i = 0; i < 4; i += 1) {
      await attempt();
    }
    expect((await attempt()).statusCode).toBe(429);
    await app.close();
  });
});
