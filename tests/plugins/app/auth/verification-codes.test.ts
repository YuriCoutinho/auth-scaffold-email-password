import { describe, expect, it, vi } from "vitest";
import {
  MAX_CODE_ATTEMPTS,
  MAX_CODE_SEND_COUNT,
  RESEND_COOLDOWN_SECONDS,
} from "../../../../src/lib/session.js";
import {
  hashOtpCode,
  hashVerificationToken,
} from "../../../../src/lib/token-hash.js";
import { DEFAULT_TTL, type TtlPolicy } from "../../../../src/lib/ttl.js";
import type { VerificationPurpose } from "../../../../src/plugins/app/auth/repository.js";
import { createVerificationCodes } from "../../../../src/plugins/app/auth/verification-codes.js";
import { FakeEmailSender } from "../../../../src/plugins/email/drivers/fake.js";
import type { EmailSender } from "../../../../src/plugins/email/sender.js";
import { EmailProviderError } from "../../../../src/plugins/email/sender.js";
import { TEST_HMAC_SECRET } from "../../../helpers/app-options.js";
import {
  createInMemoryStore,
  type InMemorySeed,
} from "../../../helpers/in-memory-store.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "owner@example.com";
const USER = { id: USER_ID, email: EMAIL };
const CODE = "123456";
const TOKEN = "a-verification-token";

function secondsAgo(seconds: number) {
  return new Date(NOW.getTime() - seconds * 1000);
}

function setup(
  options: {
    seed?: InMemorySeed;
    emailSender?: EmailSender;
    ttl?: TtlPolicy;
  } = {},
) {
  const store = createInMemoryStore(
    options.seed ?? { users: [{ id: USER_ID, email: EMAIL }] },
  );
  const repo = store.legacy;
  const fake = new FakeEmailSender();
  const emailSender = options.emailSender ?? fake;
  const send = vi.spyOn(emailSender, "send");
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const codes = createVerificationCodes({
    hmacSecret: TEST_HMAC_SECRET,
    repo,
    emailSender,
    ttl: options.ttl ?? DEFAULT_TTL,
    log,
    now: () => NOW,
  });
  const stored = (purpose: VerificationPurpose) =>
    store.verificationCodes.get(`${USER_ID}:${purpose}`);
  return { store, repo, fake, send, log, codes, stored };
}

// A user with a code already on file, reached through the token TOKEN.
function seedWithCode(
  purpose: VerificationPurpose,
  code: Partial<{
    codeAttempts: number;
    codeSendCount: number;
    issuedAt: Date;
    expiresAt: Date;
    codeHash: string;
  }> = {},
  emailVerifiedAt: Date | null = new Date(0),
): InMemorySeed {
  return {
    users: [{ id: USER_ID, email: EMAIL, emailVerifiedAt }],
    verificationCodes: [
      {
        userId: USER_ID,
        purpose,
        tokenHash: hashVerificationToken(TOKEN),
        codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
        codeAttempts: 0,
        codeSendCount: 1,
        issuedAt: NOW,
        ...code,
      },
    ],
  };
}

function codeIn(subject: string | undefined) {
  return subject?.match(/\d{6}/)?.[0] ?? "";
}

// A send the test settles by hand, so it can act between the write and the
// compensation that follows a failed delivery.
function deferredSender() {
  let reject: (error: Error) => void = () => {};
  const emailSender: EmailSender = {
    send: () =>
      new Promise((_resolve, rejectSend) => {
        reject = rejectSend;
      }),
  };
  return { emailSender, fail: (error: Error) => reject(error) };
}

describe("verification codes: request", () => {
  it("issues a first code, stores only hashes and emails the code", async () => {
    const { codes, stored, fake } = setup();

    const token = await codes.request(USER, "password_reset");

    const row = stored("password_reset");
    expect(row).toMatchObject({
      tokenHash: hashVerificationToken(token),
      codeAttempts: 0,
      codeSendCount: 1,
      issuedAt: NOW,
    });
    expect(Object.values(row ?? {})).not.toContain(token);
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    expect(fake.sent[0]?.to).toBe(EMAIL);
    const code = codeIn(fake.sent[0]?.subject);
    expect(code).toMatch(/^\d{6}$/);
    expect(row?.codeHash).toBe(hashOtpCode(TEST_HMAC_SECRET, code));
    expect(Object.values(row ?? {})).not.toContain(code);
  });

  it("hands out a new token on every call and retires the previous one", async () => {
    const { codes, repo, store } = setup();

    const first = await codes.request(USER, "password_reset");
    const second = await codes.request(USER, "password_reset");

    expect(second).not.toBe(first);
    expect(
      await repo.findVerificationCodeByTokenHash(
        "password_reset",
        hashVerificationToken(first),
      ),
    ).toBeUndefined();
    expect(
      await repo.findVerificationCodeByTokenHash(
        "password_reset",
        hashVerificationToken(second),
      ),
    ).toMatchObject({ userId: USER_ID });
    expect(store.verificationCodes.size).toBe(1);
  });

  it("only rotates the token inside the cooldown", async () => {
    const issuedAt = secondsAgo(RESEND_COOLDOWN_SECONDS - 1);
    const { codes, stored, send } = setup({
      seed: seedWithCode("password_reset", { issuedAt, codeAttempts: 2 }),
    });

    const token = await codes.request(USER, "password_reset");

    expect(send).not.toHaveBeenCalled();
    expect(stored("password_reset")).toEqual({
      userId: USER_ID,
      purpose: "password_reset",
      tokenHash: hashVerificationToken(token),
      codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
      codeAttempts: 2,
      codeSendCount: 1,
      issuedAt,
      expiresAt: new Date(
        issuedAt.getTime() + DEFAULT_TTL.passwordResetCodeSeconds * 1000,
      ),
    });
  });

  it("issues a new code once the cooldown has passed", async () => {
    const { codes, stored, fake } = setup({
      seed: seedWithCode("password_reset", {
        issuedAt: secondsAgo(RESEND_COOLDOWN_SECONDS),
        codeSendCount: 2,
        codeAttempts: 3,
      }),
    });

    await codes.request(USER, "password_reset");

    const row = stored("password_reset");
    expect(row).toMatchObject({
      codeSendCount: 3,
      codeAttempts: 0,
      issuedAt: NOW,
    });
    expect(row?.codeHash).not.toBe(hashOtpCode(TEST_HMAC_SECRET, CODE));
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
  });

  it("only rotates the token once the send cap is reached", async () => {
    const issuedAt = secondsAgo(600);
    const { codes, stored, send } = setup({
      seed: seedWithCode("password_reset", {
        issuedAt,
        codeSendCount: MAX_CODE_SEND_COUNT,
      }),
    });

    const token = await codes.request(USER, "password_reset");

    expect(send).not.toHaveBeenCalled();
    expect(stored("password_reset")).toMatchObject({
      tokenHash: hashVerificationToken(token),
      codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
      codeSendCount: MAX_CODE_SEND_COUNT,
      issuedAt,
    });
  });

  it("owes no cooldown after a code that was never delivered", async () => {
    const { codes, stored, fake } = setup({
      seed: seedWithCode("password_reset", {
        issuedAt: secondsAgo(1),
        codeSendCount: 0,
      }),
    });

    await codes.request(USER, "password_reset");

    expect(stored("password_reset")).toMatchObject({
      codeSendCount: 1,
      issuedAt: NOW,
    });
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
  });

  it("starts from scratch when the code on file has expired, cap included", async () => {
    const { codes, stored, fake } = setup({
      seed: seedWithCode("password_reset", {
        issuedAt: secondsAgo(DEFAULT_TTL.passwordResetCodeSeconds),
        codeSendCount: MAX_CODE_SEND_COUNT,
        codeAttempts: 4,
      }),
    });

    await codes.request(USER, "password_reset");

    expect(stored("password_reset")).toMatchObject({
      codeSendCount: 1,
      codeAttempts: 0,
      issuedAt: NOW,
    });
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
  });

  it("judges a code live or expired by its stored expiry, not the ttl", async () => {
    const seed = (expiresAt: Date) =>
      seedWithCode("password_reset", {
        issuedAt: secondsAgo(20 * 60),
        expiresAt,
        codeSendCount: MAX_CODE_SEND_COUNT,
      });
    // Both run under a TTL that disagrees with what each code was issued with.
    const expired = setup({
      seed: seed(secondsAgo(5 * 60)),
      ttl: { ...DEFAULT_TTL, passwordResetCodeSeconds: 60 * 60 },
    });
    const live = setup({
      seed: seed(new Date(NOW.getTime() + 5 * 60 * 1000)),
      ttl: { ...DEFAULT_TTL, passwordResetCodeSeconds: 60 },
    });

    await expired.codes.request(USER, "password_reset");
    await live.codes.request(USER, "password_reset");

    expect(expired.stored("password_reset")?.codeSendCount).toBe(1);
    expect(live.stored("password_reset")?.codeSendCount).toBe(
      MAX_CODE_SEND_COUNT,
    );
    expect(live.send).not.toHaveBeenCalled();
  });

  it("stamps a new code with its purpose ttl", async () => {
    const { codes, stored } = setup();

    await codes.request(USER, "password_reset");

    expect(stored("password_reset")?.expiresAt).toEqual(
      new Date(NOW.getTime() + DEFAULT_TTL.passwordResetCodeSeconds * 1000),
    );
  });

  it("keeps the expiry when only the token rotates", async () => {
    const expiresAt = new Date(NOW.getTime() + 10 * 60 * 1000);
    const { codes, stored } = setup({
      seed: seedWithCode("password_reset", {
        issuedAt: secondsAgo(10),
        expiresAt,
      }),
    });

    await codes.request(USER, "password_reset");

    expect(stored("password_reset")?.expiresAt).toEqual(expiresAt);
  });

  it("does not wait for the provider before returning", async () => {
    const { emailSender } = deferredSender();
    const { codes, send } = setup({ emailSender });

    await expect(codes.request(USER, "password_reset")).resolves.toEqual(
      expect.any(String),
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it("restores the previous code when delivery fails, leaving the new token", async () => {
    const previousIssuedAt = secondsAgo(600);
    const { codes, stored } = setup({
      seed: seedWithCode("password_reset", {
        issuedAt: previousIssuedAt,
        codeSendCount: 3,
        codeAttempts: 2,
      }),
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });

    const token = await codes.request(USER, "password_reset");

    await vi.waitFor(() =>
      expect(stored("password_reset")?.codeSendCount).toBe(3),
    );
    expect(stored("password_reset")).toEqual({
      userId: USER_ID,
      purpose: "password_reset",
      tokenHash: hashVerificationToken(token),
      codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
      codeAttempts: 2,
      codeSendCount: 3,
      issuedAt: previousIssuedAt,
      expiresAt: new Date(
        previousIssuedAt.getTime() +
          DEFAULT_TTL.passwordResetCodeSeconds * 1000,
      ),
    });
  });

  it("keeps a first code on file with a zero send count when its delivery fails", async () => {
    const { codes, stored, repo } = setup({
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });

    const token = await codes.request(USER, "password_reset");

    await vi.waitFor(() =>
      expect(stored("password_reset")?.codeSendCount).toBe(0),
    );
    expect(
      await repo.findVerificationCodeByTokenHash(
        "password_reset",
        hashVerificationToken(token),
      ),
    ).toBeDefined();
  });

  it("does not restore over a newer code when a late delivery fails", async () => {
    const { emailSender, fail } = deferredSender();
    const { codes, stored, repo } = setup({ emailSender });

    await codes.request(USER, "password_reset");
    await repo.saveVerificationCode({
      userId: USER_ID,
      purpose: "password_reset",
      tokenHash: "newer-token-hash",
      codeHash: "newer-code-hash",
      codeAttempts: 0,
      codeSendCount: 4,
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 15 * 60 * 1000),
    });
    fail(new Error("down"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stored("password_reset")).toMatchObject({
      tokenHash: "newer-token-hash",
      codeHash: "newer-code-hash",
      codeSendCount: 4,
    });
  });

  it("logs a failed compensation instead of letting it escape", async () => {
    const { codes, repo, log } = setup({
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });
    repo.restoreVerificationCode = vi
      .fn()
      .mockRejectedValue(new Error("db down"));

    await codes.request(USER, "password_reset");

    await vi.waitFor(() =>
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "password_reset" }),
        "failed to restore verification code after delivery failure",
      ),
    );
  });

  it("logs the provider status of a failed delivery and never the address", async () => {
    const { codes, log } = setup({
      emailSender: {
        send: vi
          .fn()
          .mockRejectedValue(new EmailProviderError("down", { status: 502 })),
      },
    });

    await codes.request(USER, "password_reset");

    await vi.waitFor(() =>
      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ providerStatus: 502 }),
        "password reset code email delivery failed",
      ),
    );
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(EMAIL);
  });

  it("logs a delivered code without the address", async () => {
    const { codes, log } = setup();

    await codes.request(USER, "password_reset");

    await vi.waitFor(() =>
      expect(log.info).toHaveBeenCalledWith(
        {
          userId: USER_ID,
          purpose: "password_reset",
          providerMessageId: "fake-1",
        },
        "password reset code email sent",
      ),
    );
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(EMAIL);
  });

  it("states the configured ttl in the email", async () => {
    const { codes, fake } = setup({
      ttl: { ...DEFAULT_TTL, passwordResetCodeSeconds: 45 * 60 },
    });

    await codes.request(USER, "password_reset");

    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    expect(fake.sent[0]?.text).toContain("45 minutes");
  });
});

describe("verification codes: startSignup", () => {
  const newUser = (passwordHash = "new-hash") => ({
    id: USER_ID,
    email: EMAIL,
    passwordHash,
    createdAt: NOW,
  });

  it("creates the unconfirmed account and emails its first code", async () => {
    const { codes, store, stored, fake } = setup({ seed: {} });

    const started = await codes.startSignup(newUser());

    expect(started).toEqual({ userId: USER_ID, token: expect.any(String) });
    expect(store.users.get(USER_ID)).toMatchObject({
      email: EMAIL,
      passwordHash: "new-hash",
      emailVerifiedAt: null,
    });
    expect(stored("signup")).toMatchObject({
      tokenHash: hashVerificationToken(started?.token ?? ""),
      codeSendCount: 1,
      codeAttempts: 0,
      issuedAt: NOW,
    });
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    expect(fake.sent[0]?.to).toBe(EMAIL);
    expect(stored("signup")?.codeHash).toBe(
      hashOtpCode(TEST_HMAC_SECRET, codeIn(fake.sent[0]?.subject)),
    );
  });

  it("replaces the password of a pending account and rotates only the token inside the cooldown", async () => {
    const { codes, store, stored, send } = setup({
      seed: seedWithCode("signup", { issuedAt: secondsAgo(5) }, null),
    });

    const started = await codes.startSignup(newUser("newer-hash"));

    expect(store.users.get(USER_ID)?.passwordHash).toBe("newer-hash");
    expect(stored("signup")).toMatchObject({
      tokenHash: hashVerificationToken(started?.token ?? ""),
      codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
      codeSendCount: 1,
      issuedAt: secondsAgo(5),
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("returns null and writes nothing for a confirmed address", async () => {
    const { codes, store, send } = setup({
      seed: { users: [{ id: USER_ID, email: EMAIL, passwordHash: "kept" }] },
    });

    expect(await codes.startSignup(newUser())).toBeNull();

    expect(store.users.get(USER_ID)?.passwordHash).toBe("kept");
    expect(store.verificationCodes.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("states the configured signup ttl in the email", async () => {
    const { codes, fake } = setup({
      seed: {},
      ttl: { ...DEFAULT_TTL, signupCodeSeconds: 30 * 60 },
    });

    await codes.startSignup(newUser());

    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    expect(fake.sent[0]?.subject).toContain("verification code");
    expect(fake.sent[0]?.text).toContain("30 minutes");
  });

  it("restores the code when the first signup email fails", async () => {
    const { codes, stored } = setup({
      seed: {},
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });

    const started = await codes.startSignup(newUser());

    await vi.waitFor(() => expect(stored("signup")?.codeSendCount).toBe(0));
    expect(stored("signup")?.tokenHash).toBe(
      hashVerificationToken(started?.token ?? ""),
    );
  });
});

describe("verification codes: resend", () => {
  it("rejects a token that matches no code", async () => {
    const { codes, send } = setup();

    expect(await codes.resend("signup", "unknown-token")).toBe(
      "invalid-session",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a token of another purpose", async () => {
    const { codes } = setup({ seed: seedWithCode("password_reset") });

    expect(await codes.resend("signup", TOKEN)).toBe("invalid-session");
  });

  it("rejects an expired code", async () => {
    const { codes, send } = setup({
      seed: seedWithCode(
        "signup",
        { issuedAt: secondsAgo(DEFAULT_TTL.signupCodeSeconds) },
        null,
      ),
    });

    expect(await codes.resend("signup", TOKEN)).toBe("invalid-session");
    expect(send).not.toHaveBeenCalled();
  });

  it("reports the cooldown and changes nothing", async () => {
    const seed = seedWithCode("signup", { issuedAt: secondsAgo(5) }, null);
    const { codes, stored, send } = setup({ seed });
    const before = { ...stored("signup") };

    expect(await codes.resend("signup", TOKEN)).toBe("cooldown");
    expect(stored("signup")).toEqual(before);
    expect(send).not.toHaveBeenCalled();
  });

  it("reports the send cap and changes nothing", async () => {
    const { codes, stored, send } = setup({
      seed: seedWithCode(
        "signup",
        { issuedAt: secondsAgo(600), codeSendCount: MAX_CODE_SEND_COUNT },
        null,
      ),
    });

    expect(await codes.resend("signup", TOKEN)).toBe("limit-reached");
    expect(stored("signup")?.codeSendCount).toBe(MAX_CODE_SEND_COUNT);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends a new code, waits for delivery and keeps the token", async () => {
    const { codes, stored, fake } = setup({
      seed: seedWithCode(
        "signup",
        { issuedAt: secondsAgo(120), codeSendCount: 2, codeAttempts: 3 },
        null,
      ),
    });

    expect(await codes.resend("signup", TOKEN)).toBe("sent");

    expect(fake.sent).toHaveLength(1);
    const code = codeIn(fake.sent[0]?.subject);
    expect(stored("signup")).toEqual({
      userId: USER_ID,
      purpose: "signup",
      tokenHash: hashVerificationToken(TOKEN),
      codeHash: hashOtpCode(TEST_HMAC_SECRET, code),
      codeAttempts: 0,
      codeSendCount: 3,
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + DEFAULT_TTL.signupCodeSeconds * 1000),
    });
  });

  it("owes no cooldown after a code that was never delivered", async () => {
    const { codes, stored } = setup({
      seed: seedWithCode(
        "signup",
        { issuedAt: secondsAgo(1), codeSendCount: 0 },
        null,
      ),
    });

    expect(await codes.resend("signup", TOKEN)).toBe("sent");
    expect(stored("signup")?.codeSendCount).toBe(1);
  });

  it("restores the previous code and reports the email as unavailable when delivery fails", async () => {
    const issuedAt = secondsAgo(120);
    const expiresAt = new Date(NOW.getTime() + 60 * 1000);
    const { codes, stored } = setup({
      seed: seedWithCode(
        "signup",
        { issuedAt, expiresAt, codeSendCount: 2, codeAttempts: 1 },
        null,
      ),
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });

    expect(await codes.resend("signup", TOKEN)).toBe("email-unavailable");
    expect(stored("signup")).toEqual({
      userId: USER_ID,
      purpose: "signup",
      tokenHash: hashVerificationToken(TOKEN),
      codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
      codeAttempts: 1,
      codeSendCount: 2,
      issuedAt,
      expiresAt,
    });
  });

  it("still reports the email as unavailable when the restore fails", async () => {
    const { codes, repo, log } = setup({
      seed: seedWithCode("signup", { issuedAt: secondsAgo(120) }, null),
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });
    repo.restoreVerificationCode = vi
      .fn()
      .mockRejectedValue(new Error("db down"));

    expect(await codes.resend("signup", TOKEN)).toBe("email-unavailable");
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "signup" }),
      "failed to restore verification code after resend failure",
    );
  });
});

describe("verification codes: verify", () => {
  it("rejects a missing token without a lookup", async () => {
    const { codes, repo } = setup({ seed: seedWithCode("signup") });
    const lookup = vi.spyOn(repo, "findVerificationCodeByTokenHash");

    expect(await codes.verify("signup", undefined, CODE)).toEqual({
      outcome: "invalid",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects an unknown token and logs it without the token", async () => {
    const { codes, log } = setup({ seed: seedWithCode("signup") });

    expect(await codes.verify("signup", "unknown-token", CODE)).toEqual({
      outcome: "invalid",
    });
    expect(log.info).toHaveBeenCalledWith(
      { purpose: "signup" },
      "signup code token not recognized",
    );
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("unknown-token");
  });

  it("rejects a token of another purpose", async () => {
    const { codes } = setup({ seed: seedWithCode("signup") });

    expect(await codes.verify("password_reset", TOKEN, CODE)).toEqual({
      outcome: "invalid",
    });
  });

  it("rejects an expired code, even the right one, without counting an attempt", async () => {
    const { codes, stored, log } = setup({
      seed: seedWithCode("signup", {
        issuedAt: secondsAgo(DEFAULT_TTL.signupCodeSeconds),
      }),
    });

    expect(await codes.verify("signup", TOKEN, CODE)).toEqual({
      outcome: "invalid",
    });
    expect(stored("signup")?.codeAttempts).toBe(0);
    expect(log.info).toHaveBeenCalledWith(
      { userId: USER_ID, purpose: "signup" },
      "signup code expired",
    );
  });

  it("rejects a code exactly at its stored expiry", async () => {
    const { codes } = setup({
      seed: seedWithCode("signup", {
        issuedAt: secondsAgo(60),
        expiresAt: NOW,
      }),
    });

    expect(await codes.verify("signup", TOKEN, CODE)).toEqual({
      outcome: "invalid",
    });
  });

  it("trusts the stored expiry over the configured ttl", async () => {
    const { codes } = setup({
      seed: seedWithCode("signup", {
        issuedAt: secondsAgo(120),
        expiresAt: secondsAgo(60),
      }),
      ttl: { ...DEFAULT_TTL, signupCodeSeconds: 60 * 60 },
    });

    expect(await codes.verify("signup", TOKEN, CODE)).toEqual({
      outcome: "invalid",
    });
  });

  it("keeps an exhausted code unusable even when the right code arrives", async () => {
    const { codes, stored } = setup({
      seed: seedWithCode("signup", { codeAttempts: MAX_CODE_ATTEMPTS }),
    });

    expect(await codes.verify("signup", TOKEN, CODE)).toEqual({
      outcome: "invalid",
    });
    expect(stored("signup")?.codeAttempts).toBe(MAX_CODE_ATTEMPTS);
  });

  it("counts a wrong code as an attempt and warns without the code", async () => {
    const { codes, stored, log } = setup({ seed: seedWithCode("signup") });

    expect(await codes.verify("signup", TOKEN, "000000")).toEqual({
      outcome: "invalid",
    });
    expect(stored("signup")?.codeAttempts).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(
      { userId: USER_ID, purpose: "signup", codeAttempts: 1 },
      "signup code verification failed",
    );
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("000000");
  });

  it("warns that the code is invalidated on the last allowed attempt", async () => {
    const { codes, stored, log } = setup({
      seed: seedWithCode("password_reset", {
        codeAttempts: MAX_CODE_ATTEMPTS - 1,
      }),
    });

    await codes.verify("password_reset", TOKEN, "000000");

    expect(stored("password_reset")?.codeAttempts).toBe(MAX_CODE_ATTEMPTS);
    expect(log.warn).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        purpose: "password_reset",
        codeAttempts: MAX_CODE_ATTEMPTS,
      },
      "password reset code invalidated after too many failed attempts",
    );
  });

  it("returns the record for the right code without consuming it", async () => {
    const { codes, stored } = setup({
      seed: seedWithCode("signup", { codeAttempts: 2 }),
    });

    expect(await codes.verify("signup", TOKEN, CODE)).toEqual({
      outcome: "valid",
      code: {
        userId: USER_ID,
        purpose: "signup",
        tokenHash: hashVerificationToken(TOKEN),
        codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
        codeAttempts: 2,
        codeSendCount: 1,
        issuedAt: NOW,
        expiresAt: new Date(
          NOW.getTime() + DEFAULT_TTL.signupCodeSeconds * 1000,
        ),
        email: EMAIL,
        passwordHash: "seeded-hash",
      },
    });
    expect(stored("signup")?.codeAttempts).toBe(2);
  });
});
