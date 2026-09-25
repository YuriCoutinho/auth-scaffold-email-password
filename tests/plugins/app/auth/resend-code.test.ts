import { describe, expect, it, vi } from "vitest";
import {
  MAX_CODE_SEND_COUNT,
  RESEND_COOLDOWN_SECONDS,
} from "../../../../src/lib/session.js";
import {
  hashOtpCode,
  hashVerificationToken,
} from "../../../../src/lib/token-hash.js";
import { DEFAULT_TTL } from "../../../../src/lib/ttl.js";
import { createResendCodeService } from "../../../../src/plugins/app/auth/resend-code.js";
import { createVerificationCodes } from "../../../../src/plugins/app/auth/verification-codes.js";
import { FakeEmailSender } from "../../../../src/plugins/email/drivers/fake.js";
import type { EmailSender } from "../../../../src/plugins/email/sender.js";
import { TEST_HMAC_SECRET } from "../../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../../helpers/auth/in-memory-repository.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "user@example.com";
const TOKEN = "signup-token";

function setup(
  code: { codeSendCount?: number; issuedAt?: Date } = {},
  emailSender: EmailSender = new FakeEmailSender(),
) {
  const repo = createInMemoryAuthRepository({
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
  const codes = createVerificationCodes({
    hmacSecret: TEST_HMAC_SECRET,
    repo,
    emailSender,
    ttl: DEFAULT_TTL,
    now: () => NOW,
  });
  const { resendCode } = createResendCodeService({ codes });
  const stored = () => repo.verificationCodes.get(`${USER_ID}:signup`);
  return { repo, send, resendCode, stored };
}

describe("resendCode", () => {
  it("rejects a missing cookie without sending anything", async () => {
    const { send, resendCode } = setup();

    expect(await resendCode(undefined)).toEqual({ outcome: "invalid-session" });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a token that matches no signup", async () => {
    const { send, resendCode } = setup();

    expect(await resendCode("not-a-real-token")).toEqual({
      outcome: "invalid-session",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an expired signup", async () => {
    const { resendCode } = setup({
      issuedAt: new Date(NOW.getTime() - DEFAULT_TTL.signupCodeSeconds * 1000),
    });

    expect(await resendCode(TOKEN)).toEqual({ outcome: "invalid-session" });
  });

  it("sends a new code and hands back the same token", async () => {
    const { send, resendCode, stored } = setup();

    expect(await resendCode(TOKEN)).toEqual({
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
    const { send, resendCode } = setup({ issuedAt: NOW });

    expect(await resendCode(TOKEN)).toEqual({ outcome: "cooldown" });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports the send cap", async () => {
    const { send, resendCode } = setup({ codeSendCount: MAX_CODE_SEND_COUNT });

    expect(await resendCode(TOKEN)).toEqual({ outcome: "limit-reached" });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports an unavailable email and keeps the previous code", async () => {
    const { resendCode, stored } = setup(
      {},
      { send: vi.fn().mockRejectedValue(new Error("down")) },
    );

    expect(await resendCode(TOKEN)).toEqual({ outcome: "email-unavailable" });
    expect(stored()).toMatchObject({
      codeHash: hashOtpCode(TEST_HMAC_SECRET, "123456"),
      codeSendCount: 1,
    });
  });
});
