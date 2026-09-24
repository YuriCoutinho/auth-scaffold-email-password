import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../src/app.js";
import { FakeEmailSender } from "../../../src/plugins/app/email/drivers/fake.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/auth/in-memory-repository.js";

const BODY = { email: "reset@example.com" };

async function setup() {
  const authRepository = createInMemoryAuthRepository({
    users: [
      { email: "reset@example.com", passwordHash: "old" },
      { email: "pending@example.com", emailVerifiedAt: null },
    ],
  });
  const emailSender = new FakeEmailSender();
  const app = await buildApp(makeAppOptions({ authRepository, emailSender }));
  return { app, authRepository, emailSender };
}

describe("POST /auth/forgot-password", () => {
  it("answers 202 with a generic message and sets the reset cookie", async () => {
    const { app } = await setup();

    const response = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: BODY,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      message: "If the email is valid, we sent a reset code.",
    });
    const cookie = response.cookies.find((c) => c.name === "password_reset");
    expect(cookie).toMatchObject({
      path: "/auth",
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: 900,
    });
    expect(cookie?.value).toBeTruthy();

    await app.close();
  });

  it("answers byte for byte the same for an address with no account", async () => {
    const { app } = await setup();

    const known = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: BODY,
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: "nobody@example.com" },
    });

    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    expect(
      unknown.cookies.find((c) => c.name === "password_reset")?.value,
    ).toBeTruthy();

    await app.close();
  });

  it("rejects a malformed address with 400", async () => {
    const { app } = await setup();

    const response = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: "not-an-email" },
    });

    expect(response.statusCode).toBe(400);
    expect(
      response.cookies.find((c) => c.name === "password_reset"),
    ).toBeUndefined();

    await app.close();
  });

  it("delivers the code out of band", async () => {
    const { app, emailSender } = await setup();

    await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: BODY,
    });

    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));

    await app.close();
  });

  it("treats an unconfirmed account like no account at all", async () => {
    const { app, authRepository, emailSender } = await setup();

    const known = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: BODY,
    });
    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));
    const pending = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: "pending@example.com" },
    });

    expect(pending.statusCode).toBe(known.statusCode);
    expect(pending.body).toBe(known.body);
    expect(
      pending.cookies.find((c) => c.name === "password_reset")?.value,
    ).toBeTruthy();
    expect(
      [...authRepository.verificationCodes.values()].map((c) => c.purpose),
    ).toEqual(["password_reset"]);
    expect(emailSender.sent).toHaveLength(1);

    await app.close();
  });

  it("hands out a different cookie on every call, with and without an account", async () => {
    const { app } = await setup();

    const cookieOf = async (email: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/forgot-password",
        payload: { email },
      });
      return response.cookies.find((c) => c.name === "password_reset")?.value;
    };

    const knownFirst = await cookieOf("reset@example.com");
    const knownSecond = await cookieOf("reset@example.com");
    const unknownFirst = await cookieOf("nobody@example.com");
    const unknownSecond = await cookieOf("nobody@example.com");

    expect(knownFirst).toBeTruthy();
    expect(unknownFirst).toBeTruthy();
    // A cookie that repeats for one address and not for the other would tell
    // the two apart in two requests.
    expect(knownSecond).not.toBe(knownFirst);
    expect(unknownSecond).not.toBe(unknownFirst);

    await app.close();
  });
});
