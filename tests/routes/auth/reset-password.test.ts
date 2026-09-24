import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashPassword } from "../../../src/lib/password.js";
import { hashOtpCode } from "../../../src/lib/token-hash.js";
import { FakeEmailSender } from "../../../src/plugins/app/email/drivers/fake.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/auth/in-memory-repository.js";

const CODE = "123456";
const NEW_PASSWORD = "a-brand-new-passphrase";
const OLD_PASSWORD = "the-previous-passphrase";

async function setup(overrides: Record<string, unknown> = {}) {
  const authRepository = createInMemoryAuthRepository({
    authUsers: [
      {
        id: 1,
        email: "reset@example.com",
        passwordHash: await hashPassword(OLD_PASSWORD),
      },
    ],
  });
  await authRepository.upsertPasswordReset({
    userId: 1,
    codeHash: hashOtpCode(CODE),
    resetSessionToken: "tok",
    expiresAt: new Date(Date.now() + 600_000),
    now: new Date(),
  });
  const emailSender = new FakeEmailSender();
  const app = await buildApp(
    makeAppOptions({ authRepository, emailSender, ...overrides }),
  );
  return { app, authRepository, emailSender };
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
    const { app } = await setup();

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
    const { app } = await setup();

    const response = await inject(app, {
      code: "000000",
      newPassword: NEW_PASSWORD,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });

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
    const { app, authRepository } = await setup();

    const response = await inject(app, { code: "12345", newPassword: "short" });

    expect(response.statusCode).toBe(400);
    expect(await authRepository.findPasswordResetByUserId(1)).toBeDefined();

    await app.close();
  });
});
