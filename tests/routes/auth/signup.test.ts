import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashVerificationToken } from "../../../src/lib/token-hash.js";
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

    const [user] = [...authRepository.users.values()];
    expect(user).toMatchObject({
      email: "user@example.com",
      emailVerifiedAt: null,
    });
    const code = [...authRepository.verificationCodes.values()][0];
    expect(code).toMatchObject({ userId: user?.id, purpose: "signup" });
    // Only the digest of the cookie reaches the store.
    expect(code?.tokenHash).toBe(hashVerificationToken(cookie?.value ?? ""));
    expect(code?.tokenHash).not.toBe(cookie?.value);
  });

  it("follows a configured signup code ttl in the cookie maxAge", async () => {
    const response = await post(
      VALID_BODY,
      makeAppOptions({ ttl: { signupCodeSeconds: 300 } }),
    );

    expect(response.statusCode).toBe(202);
    expect(
      response.cookies.find((c) => c.name === "signup_session")?.maxAge,
    ).toBe(300);
  });

  it("returns the same generic 202 when the email already has a confirmed account", async () => {
    const authRepository = createInMemoryAuthRepository({
      users: [{ email: "user@example.com", passwordHash: "original-hash" }],
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
    expect(authRepository.verificationCodes.size).toBe(0);
    expect([...authRepository.users.values()]).toEqual([
      expect.objectContaining({ passwordHash: "original-hash" }),
    ]);
  });

  it("still answers 202 with a cookie when delivery fails", async () => {
    const opts = makeAppOptions({
      emailSender: {
        send: vi.fn().mockRejectedValue(new Error("provider down")),
      },
    });
    const response = await post(VALID_BODY, opts);
    expect(response.statusCode).toBe(202);
    expect(
      response.cookies.find((c) => c.name === "signup_session")?.value,
    ).toBeTruthy();
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

  it("hands out a different cookie on every call, whatever the address is", async () => {
    const authRepository = createInMemoryAuthRepository({
      users: [{ email: "taken@example.com" }],
    });
    const app = await buildApp(makeAppOptions({ authRepository }));

    const cookieFor = async (email: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email, password: "a-valid-long-passphrase" },
      });
      return response.cookies.find((c) => c.name === "signup_session")?.value;
    };

    const newFirst = await cookieFor("new@example.com");
    const newSecond = await cookieFor("new@example.com");
    const takenFirst = await cookieFor("taken@example.com");
    const takenSecond = await cookieFor("taken@example.com");

    expect(newFirst).toBeTruthy();
    expect(takenFirst).toBeTruthy();
    // A value that repeats for one address and not the other would answer, in
    // two requests, which addresses already have an account.
    expect(newSecond).not.toBe(newFirst);
    expect(takenSecond).not.toBe(takenFirst);

    await app.close();
  });

  it("accepts the rotated cookie on the flows that read it", async () => {
    const authRepository = createInMemoryAuthRepository();
    const app = await buildApp(makeAppOptions({ authRepository }));

    const first = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        email: "new@example.com",
        password: "a-valid-long-passphrase",
      },
    });
    const second = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        email: "new@example.com",
        password: "a-valid-long-passphrase",
      },
    });

    const stale = first.cookies.find((c) => c.name === "signup_session")?.value;
    const fresh = second.cookies.find(
      (c) => c.name === "signup_session",
    )?.value;

    const withFresh = await app.inject({
      method: "POST",
      url: "/auth/verify-code",
      payload: { code: "000000" },
      cookies: { signup_session: fresh ?? "" },
    });
    const withStale = await app.inject({
      method: "POST",
      url: "/auth/verify-code",
      payload: { code: "000000" },
      cookies: { signup_session: stale ?? "" },
    });

    // Both answer the same generic 401, so the status alone proves nothing.
    // What separates them is the side effect: only the fresh cookie reached a
    // real pending signup, so only it burned an attempt.
    expect(withFresh.statusCode).toBe(401);
    expect(withStale.statusCode).toBe(401);
    const [code] = [...authRepository.verificationCodes.values()];
    expect(code?.tokenHash).toBe(hashVerificationToken(fresh ?? ""));
    expect(code?.tokenHash).not.toBe(hashVerificationToken(stale ?? ""));
    expect(code?.codeAttempts).toBe(1);

    await app.close();
  });

  it("lets the latest signup of an unconfirmed address win and retires the old cookie", async () => {
    const authRepository = createInMemoryAuthRepository();
    const emailSender = {
      send: vi.fn().mockResolvedValue({ providerMessageId: "msg-1" }),
    };
    const app = buildApp(makeAppOptions({ authRepository, emailSender }));
    const signup = (password: string) =>
      app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email: "new@example.com", password },
      });

    const stale = (await signup("the-first-long-passphrase")).cookies.find(
      (c) => c.name === "signup_session",
    )?.value;
    await vi.waitFor(() => expect(emailSender.send).toHaveBeenCalledTimes(1));
    const code = emailSender.send.mock.calls[0]?.[0].text.match(/\d{6}/)?.[0];

    const second = await signup("the-second-long-passphrase");
    const fresh = second.cookies.find(
      (c) => c.name === "signup_session",
    )?.value;

    expect(second.statusCode).toBe(202);
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(stale);

    const verify = (cookie: string | undefined) =>
      app.inject({
        method: "POST",
        url: "/auth/verify-code",
        payload: { code },
        cookies: { signup_session: cookie ?? "" },
      });

    // The code already in the mailbox still works; only the token rotated.
    expect((await verify(stale)).statusCode).toBe(401);
    expect((await verify(fresh)).statusCode).toBe(204);

    const login = (password: string) =>
      app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "new@example.com", password },
      });
    expect((await login("the-first-long-passphrase")).statusCode).toBe(401);
    expect((await login("the-second-long-passphrase")).statusCode).toBe(204);

    await app.close();
  });
});
