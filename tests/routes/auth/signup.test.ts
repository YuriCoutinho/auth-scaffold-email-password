import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../src/app.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/auth/in-memory-repository.js";

const VALID_BODY = {
  email: "user@example.com",
  password: "a perfectly fine passphrase",
};
const GENERIC_MESSAGE = "If the email is valid, we sent a confirmation code.";

async function post(body: Record<string, unknown>, opts = makeAppOptions()) {
  const app = buildApp(opts);
  const response = await app.inject({
    method: "POST",
    url: "/auth/signup",
    payload: body,
  });
  await app.close();
  return response;
}

describe("POST /auth/signup", () => {
  it("rejects an invalid email with 400", async () => {
    expect(
      (await post({ ...VALID_BODY, email: "not-an-email" })).statusCode,
    ).toBe(400);
  });

  it("rejects an email longer than 254 chars", async () => {
    const email = `${"a".repeat(250)}@example.com`;
    expect((await post({ ...VALID_BODY, email })).statusCode).toBe(400);
  });

  it("rejects a password shorter than 15 chars", async () => {
    expect(
      (await post({ ...VALID_BODY, password: "short-password" })).statusCode,
    ).toBe(400);
  });

  it("rejects a password longer than 128 chars", async () => {
    expect(
      (await post({ ...VALID_BODY, password: "p".repeat(129) })).statusCode,
    ).toBe(400);
  });

  it("accepts unicode and spaces in the password", async () => {
    const response = await post({
      ...VALID_BODY,
      password: "corrét hôrse báttery stáple",
    });
    expect(response.statusCode).toBe(202);
  });

  it("returns 202 with the generic message and the signup session cookie", async () => {
    const authRepository = createInMemoryAuthRepository();
    const response = await post(VALID_BODY, makeAppOptions({ authRepository }));
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ message: GENERIC_MESSAGE });

    const cookie = response.cookies.find((c) => c.name === "signup_session");
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/auth",
      maxAge: 900,
    });
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      authRepository.pendingSignups.get("user@example.com")?.signupSessionToken,
    ).toBe(cookie?.value);
  });

  it("returns the same generic 202 when the email already has a confirmed account", async () => {
    const authRepository = createInMemoryAuthRepository({
      authUsers: [{ email: "user@example.com" }],
    });
    const emailSender = {
      send: vi.fn().mockResolvedValue({ providerMessageId: "msg-1" }),
    };
    const response = await post(
      VALID_BODY,
      makeAppOptions({ authRepository, emailSender }),
    );
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ message: GENERIC_MESSAGE });
    expect(response.cookies.some((c) => c.name === "signup_session")).toBe(
      true,
    );
    expect(emailSender.send).not.toHaveBeenCalled();
    expect(authRepository.pendingSignups.size).toBe(0);
  });

  it("responds 503 with a generic message when email delivery fails", async () => {
    const opts = makeAppOptions({
      emailSender: {
        send: vi.fn().mockRejectedValue(new Error("provider down")),
      },
    });
    const response = await post(VALID_BODY, opts);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      message:
        "We could not send the confirmation email right now. Please try again shortly.",
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects a pwned password with 400 and no cookie", async () => {
    const opts = makeAppOptions({
      checkPwnedPassword: vi.fn().mockResolvedValue(true),
    });
    const response = await post(VALID_BODY, opts);
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/data breach/i);
    expect(response.cookies).toHaveLength(0);
  });
});
