import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import {
  hashOtpCode,
  hashSessionToken,
  hashVerificationToken,
} from "../../../src/lib/token-hash.js";
import { makeAppOptions, TEST_HMAC_SECRET } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/auth/in-memory-repository.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "token-x";
const CODE = "123456";

function makeRepository(
  options: {
    emailVerifiedAt?: Date | null;
    codeAttempts?: number;
    issuedAt?: Date;
  } = {},
) {
  return createInMemoryAuthRepository({
    users: [
      {
        id: USER_ID,
        email: "u@e.com",
        passwordHash: "argon2-hash",
        emailVerifiedAt:
          options.emailVerifiedAt === undefined
            ? null
            : options.emailVerifiedAt,
      },
    ],
    verificationCodes: [
      {
        userId: USER_ID,
        purpose: "signup",
        tokenHash: hashVerificationToken(TOKEN),
        codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
        codeAttempts: options.codeAttempts ?? 0,
        issuedAt: options.issuedAt ?? new Date(),
      },
    ],
  });
}

async function post(
  options: {
    authRepository?: ReturnType<typeof makeRepository>;
    cookie?: boolean;
    code?: string;
  } = {},
) {
  const authRepository = options.authRepository ?? makeRepository();
  const app = buildApp(makeAppOptions({ authRepository }));
  const response = await app.inject({
    method: "POST",
    url: "/auth/verify-code",
    payload: { code: options.code ?? CODE },
    headers: { "user-agent": "Mozilla/5.0" },
    ...(options.cookie === false ? {} : { cookies: { signup_session: TOKEN } }),
  });
  await app.close();
  return { response, authRepository };
}

describe("POST /auth/verify-code", () => {
  it("responds 204, sets the session cookie and clears the signup cookie on the right code", async () => {
    const { response, authRepository } = await post();

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");

    const sessionCookie = response.cookies.find((c) => c.name === "session");
    expect(sessionCookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/",
      maxAge: 2_592_000,
    });
    expect(sessionCookie?.value).not.toBe("");

    const signupCookie = response.cookies.find(
      (c) => c.name === "signup_session",
    );
    expect(signupCookie).toMatchObject({ value: "", path: "/auth" });

    expect(authRepository.users.get(USER_ID)?.emailVerifiedAt).toBeInstanceOf(
      Date,
    );
    const sessions = [...authRepository.sessions.values()];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      userId: USER_ID,
      deviceLabel: "Mozilla/5.0",
      tokenHash: hashSessionToken(sessionCookie?.value ?? ""),
    });
    expect(sessions[0]?.tokenHash).not.toBe(sessionCookie?.value);
    expect(authRepository.verificationCodes.size).toBe(0);
  });

  it("follows a configured session ttl in the cookie maxAge", async () => {
    const authRepository = makeRepository();
    const app = buildApp(
      makeAppOptions({ authRepository, ttl: { sessionSeconds: 3600 } }),
    );
    const response = await app.inject({
      method: "POST",
      url: "/auth/verify-code",
      payload: { code: CODE },
      cookies: { signup_session: TOKEN },
    });

    expect(response.statusCode).toBe(204);
    expect(response.cookies.find((c) => c.name === "session")?.maxAge).toBe(
      3600,
    );
    await app.close();
  });

  it("responds 401 when the cookie is missing", async () => {
    const { response, authRepository } = await post({ cookie: false });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });
    expect(authRepository.users.get(USER_ID)?.emailVerifiedAt).toBeNull();
    expect(authRepository.verificationCodes.size).toBe(1);
  });

  it("responds 401 on a wrong code", async () => {
    const { response, authRepository } = await post({ code: "654321" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });
    expect(
      [...authRepository.verificationCodes.values()][0]?.codeAttempts,
    ).toBe(1);
    expect(response.cookies.find((c) => c.name === "session")).toBeUndefined();
  });

  it("responds 401 when attempts are exhausted", async () => {
    const { response, authRepository } = await post({
      authRepository: makeRepository({ codeAttempts: 5 }),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });
    expect(
      [...authRepository.verificationCodes.values()][0]?.codeAttempts,
    ).toBe(5);
    expect(authRepository.users.get(USER_ID)?.emailVerifiedAt).toBeNull();
  });

  it("responds the same 401 once the code has expired", async () => {
    const { response, authRepository } = await post({
      authRepository: makeRepository({
        issuedAt: new Date(Date.now() - 16 * 60 * 1000),
      }),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });
    expect(authRepository.sessions.size).toBe(0);
  });

  it("never signs in through a code of an account that is already confirmed", async () => {
    const { response, authRepository } = await post({
      authRepository: makeRepository({ emailVerifiedAt: new Date(0) }),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });
    expect(response.cookies.find((c) => c.name === "session")).toBeUndefined();
    expect(authRepository.sessions.size).toBe(0);
  });

  it("responds 400 on a malformed code", async () => {
    const { response } = await post({ code: "12a456" });
    expect(response.statusCode).toBe(400);
  });
});
