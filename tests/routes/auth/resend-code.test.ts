import { describe, expect, it, type Mock, vi } from "vitest";
import { buildApp } from "../../../src/app.js";
import type { PendingSignupRecord } from "../../../src/plugins/app/auth/auth-repository.js";
import type { EmailSender } from "../../../src/services/email-sender.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/in-memory-auth-repository.js";

type FakeEmailSender = { send: Mock<EmailSender["send"]> };

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
  emailSender?: FakeEmailSender;
}) {
  const authRepository = createInMemoryAuthRepository({
    pendingSignups: options.pendingRow ? [options.pendingRow] : [],
  });
  const emailSender: FakeEmailSender = options.emailSender ?? {
    send: vi.fn().mockResolvedValue({ providerMessageId: "msg-1" }),
  };
  const app = buildApp(makeAppOptions({ authRepository, emailSender }));
  const response = await app.inject({
    method: "POST",
    url: "/auth/resend-code",
    ...(options.cookie === false ? {} : { cookies: { signup_session: TOKEN } }),
  });
  await app.close();
  return { response, emailSender, authRepository };
}

describe("POST /auth/resend-code", () => {
  it("responds 202, re-sets the signup_session cookie and sends a new code", async () => {
    const { response, emailSender, authRepository } = await post({
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

    expect(emailSender.send).toHaveBeenCalledTimes(1);
    expect(emailSender.send.mock.calls[0]?.[0].to).toBe("user@example.com");
    expect(authRepository.pendingSignups.get("user@example.com")).toMatchObject(
      {
        codeAttempts: 0,
        codeSendCount: 2,
      },
    );
  });

  it("responds 401 when the cookie is missing", async () => {
    const { response, emailSender } = await post({
      pendingRow: makePendingRow(),
      cookie: false,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      message: "Invalid or expired signup session.",
    });
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it("responds 401 when the pending signup is expired", async () => {
    const { response, emailSender } = await post({
      pendingRow: makePendingRow({ expiresAt: new Date(Date.now() - 1000) }),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      message: "Invalid or expired signup session.",
    });
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it("responds 429 within the cooldown window", async () => {
    const { response, emailSender } = await post({
      pendingRow: makePendingRow({ lastSentAt: new Date(Date.now() - 10_000) }),
    });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      message: "Please wait before requesting another code.",
    });
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it("responds 429 when the resend cap is reached", async () => {
    const { response, emailSender } = await post({
      pendingRow: makePendingRow({ codeSendCount: 5 }),
    });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      message:
        "Code resend limit reached. Wait for the current signup to expire and sign up again.",
    });
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it("responds 503 without re-setting the cookie when delivery fails", async () => {
    const { response, authRepository } = await post({
      pendingRow: makePendingRow(),
      emailSender: {
        send: vi.fn().mockRejectedValue(new Error("provider down")),
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      message:
        "We could not send the confirmation email right now. Please try again shortly.",
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(authRepository.pendingSignups.get("user@example.com")).toMatchObject(
      {
        codeHash: "old-hash",
        codeSendCount: 1,
      },
    );
  });
});
