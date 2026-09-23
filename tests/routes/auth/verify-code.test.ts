import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashOtpCode, hashSessionToken } from "../../../src/lib/token-hash.js";
import type { PendingSignupRecord } from "../../../src/plugins/app/auth/repository.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/auth/in-memory-repository.js";

const TOKEN = "token-x";
const CODE = "123456";

function makePendingRow(overrides: Partial<PendingSignupRecord> = {}) {
  return {
    id: 1,
    signupSessionToken: TOKEN,
    email: "u@e.com",
    passwordHash: "argon2-hash",
    codeHash: hashOtpCode(CODE),
    codeAttempts: 0,
    lastSentAt: new Date(),
    codeSendCount: 1,
    expiresAt: new Date(Date.now() + 600_000),
    ...overrides,
  };
}

async function post(options: {
  pendingRow?: ReturnType<typeof makePendingRow>;
  cookie?: boolean;
  code?: string;
}) {
  const authRepository = createInMemoryAuthRepository({
    pendingSignups: options.pendingRow ? [options.pendingRow] : [],
  });
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
    const { response, authRepository } = await post({
      pendingRow: makePendingRow(),
    });

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

    expect(authRepository.authUsers.get("u@e.com")).toMatchObject({
      passwordHash: "argon2-hash",
    });
    expect(authRepository.sessions).toHaveLength(1);
    expect(authRepository.sessions[0]).toMatchObject({
      userId: 1,
      deviceLabel: "Mozilla/5.0",
      tokenHash: hashSessionToken(sessionCookie?.value ?? ""),
    });
    expect(authRepository.sessions[0]?.tokenHash).not.toBe(
      sessionCookie?.value,
    );
    expect(authRepository.profiles).toEqual([{ userId: 1 }]);
    expect(authRepository.pendingSignups.size).toBe(0);
  });

  it("responds 401 when the cookie is missing", async () => {
    const { response, authRepository } = await post({
      pendingRow: makePendingRow(),
      cookie: false,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });
    expect(authRepository.authUsers.size).toBe(0);
    expect(authRepository.pendingSignups.size).toBe(1);
  });

  it("responds 401 on a wrong code", async () => {
    const { response, authRepository } = await post({
      pendingRow: makePendingRow(),
      code: "654321",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });
    expect(authRepository.pendingSignups.get("u@e.com")?.codeAttempts).toBe(1);
    expect(response.cookies.find((c) => c.name === "session")).toBeUndefined();
  });

  it("responds 401 when attempts are exhausted", async () => {
    const { response, authRepository } = await post({
      pendingRow: makePendingRow({ codeAttempts: 5 }),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });
    expect(authRepository.pendingSignups.get("u@e.com")?.codeAttempts).toBe(5);
    expect(authRepository.authUsers.size).toBe(0);
  });

  it("responds 400 on a malformed code", async () => {
    const { response } = await post({
      pendingRow: makePendingRow(),
      code: "12a456",
    });
    expect(response.statusCode).toBe(400);
  });
});
