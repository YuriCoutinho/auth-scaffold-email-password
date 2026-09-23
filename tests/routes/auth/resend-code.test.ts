import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import type { PendingSignupRecord } from "../../../src/plugins/app/auth/repository.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/auth/in-memory-repository.js";

const TOKEN = "token-x";

function makePendingRow(overrides: Partial<PendingSignupRecord> = {}) {
  return {
    id: 1,
    email: "user@example.com",
    codeHash: "old-hash",
    codeAttempts: 2,
    signupSessionToken: TOKEN,
    lastSentAt: new Date(Date.now() - 120_000), // 2 min ago: outside cooldown
    codeSendCount: 1,
    expiresAt: new Date(Date.now() + 600_000), // +10 min: not expired
    ...overrides,
  };
}

async function post(options: {
  pendingRow?: ReturnType<typeof makePendingRow>;
  cookie?: boolean;
}) {
  const authRepository = createInMemoryAuthRepository({
    pendingSignups: options.pendingRow ? [options.pendingRow] : [],
  });
  const app = buildApp(makeAppOptions({ authRepository }));
  const response = await app.inject({
    method: "POST",
    url: "/auth/resend-code",
    ...(options.cookie === false ? {} : { cookies: { signup_session: TOKEN } }),
  });
  await app.close();
  return { response, authRepository };
}

describe("POST /auth/resend-code", () => {
  it("responds 202, re-sets the signup_session cookie and queues a new code", async () => {
    const { response, authRepository } = await post({
      pendingRow: makePendingRow(),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      message:
        "If your signup is still pending, we sent a new confirmation code.",
    });

    const cookie = response.cookies.find((c) => c.name === "signup_session");
    expect(cookie).toMatchObject({
      value: TOKEN,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/auth",
      maxAge: 900,
    });

    expect(authRepository.outbox.messages).toHaveLength(1);
    expect(authRepository.outbox.messages[0]).toMatchObject({
      type: "signup_code",
      recipient: "user@example.com",
      status: "pending",
    });
    expect(authRepository.pendingSignups.get("user@example.com")).toMatchObject(
      {
        codeAttempts: 0,
        codeSendCount: 2,
      },
    );
  });

  it("responds 401 when the cookie is missing", async () => {
    const { response, authRepository } = await post({
      pendingRow: makePendingRow(),
      cookie: false,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      message: "Invalid or expired signup session.",
    });
    expect(authRepository.outbox.messages).toHaveLength(0);
  });

  it("responds 401 when the pending signup is expired", async () => {
    const { response, authRepository } = await post({
      pendingRow: makePendingRow({ expiresAt: new Date(Date.now() - 1000) }),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      message: "Invalid or expired signup session.",
    });
    expect(authRepository.outbox.messages).toHaveLength(0);
  });

  it("responds 429 within the cooldown window", async () => {
    const { response, authRepository } = await post({
      pendingRow: makePendingRow({ lastSentAt: new Date(Date.now() - 10_000) }),
    });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      message: "Please wait before requesting another code.",
    });
    expect(authRepository.outbox.messages).toHaveLength(0);
  });

  it("responds 429 when the resend cap is reached", async () => {
    const { response, authRepository } = await post({
      pendingRow: makePendingRow({ codeSendCount: 5 }),
    });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      message:
        "Code resend limit reached. Wait for the current signup to expire and sign up again.",
    });
    expect(authRepository.outbox.messages).toHaveLength(0);
  });
});
