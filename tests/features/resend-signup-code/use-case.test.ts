import { describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../src/db/client.js";
import { createResendSignupCode } from "../../../src/features/resend-signup-code/use-case.js";
import {
  hashOtpCode,
  hashVerificationToken,
} from "../../../src/lib/token-hash.js";
import { DEFAULT_TTL } from "../../../src/lib/ttl.js";
import {
  MAX_CODE_SEND_COUNT,
  RESEND_COOLDOWN_SECONDS,
} from "../../../src/modules/otp/policy.js";
import { createOtpService } from "../../../src/modules/otp/service.js";
import { FakeEmailSender } from "../../../src/plugins/email/drivers/fake.js";
import type { EmailSender } from "../../../src/plugins/email/sender.js";
import { TEST_HMAC_SECRET } from "../../helpers/app-options.js";
import { createInMemoryStore } from "../../helpers/in-memory-store.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "user@example.com";
const TOKEN = "signup-token";

// The store's repository factories ignore the executor they are handed, so
// any value satisfying the type stands in for a real connection.
const db = {} as Executor;

function setup(
  code: { codeSendCount?: number; issuedAt?: Date } = {},
  emailSender: EmailSender = new FakeEmailSender(),
) {
  const store = createInMemoryStore({
    users: [{ id: USER_ID, email: EMAIL, emailVerifiedAt: null }],
    verificationCodes: [
      {
        userId: USER_ID,
        purpose: "signup",
        tokenHash: hashVerificationToken(TOKEN),
        codeHash: hashOtpCode(TEST_HMAC_SECRET, "123456"),
        codeSendCount: code.codeSendCount ?? 1,
        issuedAt:
          code.issuedAt ??
          new Date(NOW.getTime() - RESEND_COOLDOWN_SECONDS * 1000),
      },
    ],
  });
  const send = vi.spyOn(emailSender, "send");
  const otp = createOtpService({
    repo: store.repositories.otp(db),
    emailSender,
    ttl: DEFAULT_TTL,
    hmacSecret: TEST_HMAC_SECRET,
    now: () => NOW,
  });
  const resendSignupCode = createResendSignupCode({ otp });
  const stored = () => store.verificationCodes.get(`${USER_ID}:signup`);
  return { store, send, resendSignupCode, stored };
}

describe("resendSignupCode", () => {
  it("rejects a missing cookie without sending anything", async () => {
    const { send, resendSignupCode } = setup();

    expect(await resendSignupCode(undefined)).toEqual({
      outcome: "invalid-session",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a token that matches no signup", async () => {
    const { send, resendSignupCode } = setup();

    expect(await resendSignupCode("not-a-real-token")).toEqual({
      outcome: "invalid-session",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an expired signup", async () => {
    const { resendSignupCode } = setup({
      issuedAt: new Date(NOW.getTime() - DEFAULT_TTL.signupCodeSeconds * 1000),
    });

    expect(await resendSignupCode(TOKEN)).toEqual({
      outcome: "invalid-session",
    });
  });

  it("sends a new code and hands back the same token", async () => {
    const { send, resendSignupCode, stored } = setup();

    expect(await resendSignupCode(TOKEN)).toEqual({
      outcome: "sent",
      sessionToken: TOKEN,
    });
    expect(send).toHaveBeenCalledOnce();
    expect(stored()).toMatchObject({
      tokenHash: hashVerificationToken(TOKEN),
      codeSendCount: 2,
      issuedAt: NOW,
    });
  });

  it("reports the cooldown", async () => {
    const { send, resendSignupCode } = setup({ issuedAt: NOW });

    expect(await resendSignupCode(TOKEN)).toEqual({ outcome: "cooldown" });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports the send cap", async () => {
    const { send, resendSignupCode } = setup({
      codeSendCount: MAX_CODE_SEND_COUNT,
    });

    expect(await resendSignupCode(TOKEN)).toEqual({
      outcome: "limit-reached",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports an unavailable email and keeps the previous code", async () => {
    const { resendSignupCode, stored } = setup(
      {},
      { send: vi.fn().mockRejectedValue(new Error("down")) },
    );

    expect(await resendSignupCode(TOKEN)).toEqual({
      outcome: "email-unavailable",
    });
    expect(stored()).toMatchObject({
      codeHash: hashOtpCode(TEST_HMAC_SECRET, "123456"),
      codeSendCount: 1,
    });
  });
});
