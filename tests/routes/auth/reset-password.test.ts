import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashPassword } from "../../../src/lib/password.js";
import { MAX_CODE_ATTEMPTS } from "../../../src/lib/session.js";
import {
  hashOtpCode,
  hashSessionToken,
  hashVerificationToken,
} from "../../../src/lib/token-hash.js";
import { FakeEmailSender } from "../../../src/plugins/email/drivers/fake.js";
import { makeAppOptions, TEST_HMAC_SECRET } from "../../helpers/app-options.js";
import { createInMemoryStore } from "../../helpers/in-memory-store.js";

const CODE = "123456";
const NEW_PASSWORD = "a-brand-new-passphrase";
const OLD_PASSWORD = "the-previous-passphrase";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION_TOKEN = "other-device-token";

async function setup(
  overrides: Record<string, unknown> = {},
  code: { issuedAt?: Date; codeAttempts?: number } = {},
) {
  const store = createInMemoryStore({
    users: [
      {
        id: USER_ID,
        email: "reset@example.com",
        passwordHash: await hashPassword(OLD_PASSWORD),
      },
    ],
    verificationCodes: [
      {
        userId: USER_ID,
        purpose: "password_reset",
        tokenHash: hashVerificationToken("tok"),
        codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
        codeAttempts: code.codeAttempts ?? 0,
        issuedAt: code.issuedAt ?? new Date(),
      },
    ],
    sessions: [
      { userId: USER_ID, tokenHash: hashSessionToken(OTHER_SESSION_TOKEN) },
    ],
  });
  const emailSender = new FakeEmailSender();
  const app = await buildApp(
    makeAppOptions({ store, emailSender, ...overrides }),
  );
  return { app, store, emailSender };
}

function inject(
  app: Awaited<ReturnType<typeof buildApp>>,
  payload: Record<string, unknown>,
  // null, not undefined: an undefined argument falls back to the default.
  cookie: string | null = "tok",
) {
  return app.inject({
    method: "POST",
    url: "/auth/reset-password",
    payload,
    ...(cookie ? { cookies: { password_reset: cookie } } : {}),
  });
}

describe("POST /auth/reset-password", () => {
  it("answers 204, clears the reset cookie and sets the session cookie", async () => {
    const { app, store } = await setup();

    const response = await inject(app, {
      code: CODE,
      newPassword: NEW_PASSWORD,
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");

    const session = response.cookies.find((c) => c.name === "session");
    expect(session).toMatchObject({ path: "/", httpOnly: true, secure: true });
    expect(session?.value).toBeTruthy();

    const cleared = response.cookies.find((c) => c.name === "password_reset");
    expect(cleared?.value).toBe("");

    // Every older session is gone and only the one just handed out remains.
    expect([...store.sessions.values()]).toEqual([
      expect.objectContaining({
        userId: USER_ID,
        tokenHash: hashSessionToken(session?.value ?? ""),
      }),
    ]);
    expect(store.verificationCodes.size).toBe(0);

    await app.close();
  });

  it("leaves the caller signed in, so GET /me answers with the account", async () => {
    const { app } = await setup();

    const reset = await inject(app, { code: CODE, newPassword: NEW_PASSWORD });
    const session = reset.cookies.find((c) => c.name === "session");

    const me = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session: session?.value ?? "" },
    });

    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe("reset@example.com");

    await app.close();
  });

  it("answers 401 with one generic message for a wrong code", async () => {
    const { app, store } = await setup();

    const response = await inject(app, {
      code: "000000",
      newPassword: NEW_PASSWORD,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });
    expect([...store.verificationCodes.values()][0]?.codeAttempts).toBe(1);
    expect(store.sessions.size).toBe(1);

    await app.close();
  });

  it("answers the same 401 when the cookie is missing", async () => {
    const { app } = await setup();

    const response = await inject(
      app,
      { code: CODE, newPassword: NEW_PASSWORD },
      null,
    );

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });

    await app.close();
  });

  it("answers the same 401 for a cookie that matches no reset", async () => {
    const { app } = await setup();

    const response = await inject(
      app,
      { code: CODE, newPassword: NEW_PASSWORD },
      "throwaway-token",
    );

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });

    await app.close();
  });

  it("answers 400 when the new password is the current one", async () => {
    const { app } = await setup();

    const response = await inject(app, {
      code: CODE,
      newPassword: OLD_PASSWORD,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      message: "The new password must be different from the current one.",
    });

    await app.close();
  });

  it("answers 400 for a breached password", async () => {
    const { app } = await setup({
      checkPwnedPassword: vi.fn().mockResolvedValue(true),
    });

    const response = await inject(app, {
      code: CODE,
      newPassword: NEW_PASSWORD,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("known data breach");

    await app.close();
  });

  it("answers 400 for a malformed body without reaching the service", async () => {
    const { app, store } = await setup();

    const response = await inject(app, { code: "12345", newPassword: "short" });

    expect(response.statusCode).toBe(400);
    expect(store.verificationCodes.size).toBe(1);

    await app.close();
  });

  it("answers the same 401 once the reset has expired", async () => {
    const { app, store } = await setup(
      {},
      { issuedAt: new Date(Date.now() - 16 * 60 * 1000) },
    );

    const response = await inject(app, {
      code: CODE,
      newPassword: NEW_PASSWORD,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });
    expect(store.sessions.size).toBe(1);

    await app.close();
  });

  it("answers the same 401 for an exhausted code, even when it is the right one", async () => {
    const { app, store } = await setup({}, { codeAttempts: MAX_CODE_ATTEMPTS });

    const response = await inject(app, {
      code: CODE,
      newPassword: NEW_PASSWORD,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });
    expect(store.verificationCodes.size).toBe(1);

    await app.close();
  });
});
