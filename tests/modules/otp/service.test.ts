import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { Executor, Transaction } from "../../../src/db/client.js";
import {
  MAX_CODE_ATTEMPTS,
  MAX_CODE_SEND_COUNT,
  RESEND_COOLDOWN_SECONDS,
} from "../../../src/lib/session.js";
import {
  hashOtpCode,
  hashVerificationToken,
} from "../../../src/lib/token-hash.js";
import { DEFAULT_TTL, type TtlPolicy } from "../../../src/lib/ttl.js";
import otpPlugin from "../../../src/modules/otp/index.js";
import type {
  OtpRepository,
  VerificationPurpose,
} from "../../../src/modules/otp/repository.js";
import { createOtpService } from "../../../src/modules/otp/service.js";
import database from "../../../src/plugins/database.js";
import { FakeEmailSender } from "../../../src/plugins/email/drivers/fake.js";
import email from "../../../src/plugins/email/index.js";
import type { EmailSender } from "../../../src/plugins/email/sender.js";
import { EmailProviderError } from "../../../src/plugins/email/sender.js";
import { makeAppOptions, TEST_HMAC_SECRET } from "../../helpers/app-options.js";
import {
  createInMemoryStore,
  type InMemorySeed,
} from "../../helpers/in-memory-store.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "owner@example.com";
const USER = { id: USER_ID, email: EMAIL };
const CODE = "123456";
const TOKEN = "a-verification-token";
const db = {} as Executor;

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
  // A copy, so a test that swaps one method does not reach the store's own.
  const repo: OtpRepository = { ...store.repositories.otp(db) };
  const fake = new FakeEmailSender();
  const emailSender = options.emailSender ?? fake;
  const send = vi.spyOn(emailSender, "send");
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const otp = createOtpService({
    hmacSecret: TEST_HMAC_SECRET,
    repo,
    emailSender,
    ttl: options.ttl ?? DEFAULT_TTL,
    log,
    now: () => NOW,
  });
  const stored = (purpose: VerificationPurpose) =>
    store.verificationCodes.get(`${USER_ID}:${purpose}`);
  return { store, repo, fake, send, log, otp, stored };
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

describe("otp service: issue and dispatch", () => {
  it("issues a first code, stores only hashes and emails the code", async () => {
    const { otp, stored, fake } = setup();

    const issued = await otp.issue(USER, "password_reset");
    otp.dispatch(issued);

    expect(issued).toEqual({
      userId: USER_ID,
      token: expect.any(String),
      delivery: expect.objectContaining({
        key: { userId: USER_ID, purpose: "password_reset" },
        to: EMAIL,
      }),
    });
    const row = stored("password_reset");
    expect(row).toMatchObject({
      tokenHash: hashVerificationToken(issued.token),
      codeAttempts: 0,
      codeSendCount: 1,
      issuedAt: NOW,
    });
    expect(Object.values(row ?? {})).not.toContain(issued.token);
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    expect(fake.sent[0]?.to).toBe(EMAIL);
    const code = codeIn(fake.sent[0]?.subject);
    expect(code).toMatch(/^\d{6}$/);
    expect(row?.codeHash).toBe(hashOtpCode(TEST_HMAC_SECRET, code));
    expect(Object.values(row ?? {})).not.toContain(code);
  });

  it("sends nothing until the issued code is dispatched", async () => {
    const { otp, send } = setup();

    await otp.issue(USER, "password_reset");

    expect(send).not.toHaveBeenCalled();
  });

  it("hands out a new token on every call and retires the previous one", async () => {
    const { otp, repo, store } = setup();

    const first = await otp.issue(USER, "password_reset");
    const second = await otp.issue(USER, "password_reset");

    expect(second.token).not.toBe(first.token);
    expect(
      await repo.findByTokenHash(
        "password_reset",
        hashVerificationToken(first.token),
      ),
    ).toBeUndefined();
    expect(
      await repo.findByTokenHash(
        "password_reset",
        hashVerificationToken(second.token),
      ),
    ).toMatchObject({ userId: USER_ID });
    expect(store.verificationCodes.size).toBe(1);
  });

  it("only rotates the token inside the cooldown", async () => {
    const issuedAt = secondsAgo(RESEND_COOLDOWN_SECONDS - 1);
    const { otp, stored, send } = setup({
      seed: seedWithCode("password_reset", { issuedAt, codeAttempts: 2 }),
    });

    const issued = await otp.issue(USER, "password_reset");
    otp.dispatch(issued);

    expect(issued.delivery).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(stored("password_reset")).toEqual({
      userId: USER_ID,
      purpose: "password_reset",
      tokenHash: hashVerificationToken(issued.token),
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
    const { otp, stored, fake } = setup({
      seed: seedWithCode("password_reset", {
        issuedAt: secondsAgo(RESEND_COOLDOWN_SECONDS),
        codeSendCount: 2,
        codeAttempts: 3,
      }),
    });

    otp.dispatch(await otp.issue(USER, "password_reset"));

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
    const { otp, stored, send } = setup({
      seed: seedWithCode("password_reset", {
        issuedAt,
        codeSendCount: MAX_CODE_SEND_COUNT,
      }),
    });

    const issued = await otp.issue(USER, "password_reset");
    otp.dispatch(issued);

    expect(issued.delivery).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(stored("password_reset")).toMatchObject({
      tokenHash: hashVerificationToken(issued.token),
      codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
      codeSendCount: MAX_CODE_SEND_COUNT,
      issuedAt,
    });
  });

  it("owes no cooldown after a code that was never delivered", async () => {
    const { otp, stored, fake } = setup({
      seed: seedWithCode("password_reset", {
        issuedAt: secondsAgo(1),
        codeSendCount: 0,
      }),
    });

    otp.dispatch(await otp.issue(USER, "password_reset"));

    expect(stored("password_reset")).toMatchObject({
      codeSendCount: 1,
      issuedAt: NOW,
    });
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
  });

  it("starts from scratch when the code on file has expired, cap included", async () => {
    const { otp, stored, fake } = setup({
      seed: seedWithCode("password_reset", {
        issuedAt: secondsAgo(DEFAULT_TTL.passwordResetCodeSeconds),
        codeSendCount: MAX_CODE_SEND_COUNT,
        codeAttempts: 4,
      }),
    });

    otp.dispatch(await otp.issue(USER, "password_reset"));

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

    expired.otp.dispatch(await expired.otp.issue(USER, "password_reset"));
    live.otp.dispatch(await live.otp.issue(USER, "password_reset"));

    expect(expired.stored("password_reset")?.codeSendCount).toBe(1);
    expect(live.stored("password_reset")?.codeSendCount).toBe(
      MAX_CODE_SEND_COUNT,
    );
    expect(live.send).not.toHaveBeenCalled();
  });

  it("stamps a new code with its purpose ttl", async () => {
    const { otp, stored } = setup();

    await otp.issue(USER, "password_reset");

    expect(stored("password_reset")?.expiresAt).toEqual(
      new Date(NOW.getTime() + DEFAULT_TTL.passwordResetCodeSeconds * 1000),
    );
  });

  it("keeps the expiry when only the token rotates", async () => {
    const expiresAt = new Date(NOW.getTime() + 10 * 60 * 1000);
    const { otp, stored } = setup({
      seed: seedWithCode("password_reset", {
        issuedAt: secondsAgo(10),
        expiresAt,
      }),
    });

    await otp.issue(USER, "password_reset");

    expect(stored("password_reset")?.expiresAt).toEqual(expiresAt);
  });

  it("does not wait for the provider before returning", async () => {
    const { emailSender } = deferredSender();
    const { otp, send } = setup({ emailSender });

    const issued = await otp.issue(USER, "password_reset");

    expect(otp.dispatch(issued)).toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
  });

  it("restores the previous code when delivery fails, leaving the new token", async () => {
    const previousIssuedAt = secondsAgo(600);
    const { otp, stored } = setup({
      seed: seedWithCode("password_reset", {
        issuedAt: previousIssuedAt,
        codeSendCount: 3,
        codeAttempts: 2,
      }),
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });

    const issued = await otp.issue(USER, "password_reset");
    otp.dispatch(issued);

    await vi.waitFor(() =>
      expect(stored("password_reset")?.codeSendCount).toBe(3),
    );
    expect(stored("password_reset")).toEqual({
      userId: USER_ID,
      purpose: "password_reset",
      tokenHash: hashVerificationToken(issued.token),
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
    const { otp, stored, repo } = setup({
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });

    const issued = await otp.issue(USER, "password_reset");
    otp.dispatch(issued);

    await vi.waitFor(() =>
      expect(stored("password_reset")?.codeSendCount).toBe(0),
    );
    expect(
      await repo.findByTokenHash(
        "password_reset",
        hashVerificationToken(issued.token),
      ),
    ).toBeDefined();
  });

  it("does not restore over a newer code when a late delivery fails", async () => {
    const { emailSender, fail } = deferredSender();
    const { otp, stored, repo } = setup({ emailSender });

    otp.dispatch(await otp.issue(USER, "password_reset"));
    await repo.save({
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
    const { otp, repo, log } = setup({
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });
    repo.restore = vi.fn().mockRejectedValue(new Error("db down"));

    otp.dispatch(await otp.issue(USER, "password_reset"));

    await vi.waitFor(() =>
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "password_reset" }),
        "failed to restore verification code after delivery failure",
      ),
    );
  });

  it("logs the provider status of a failed delivery and never the address", async () => {
    const { otp, log } = setup({
      emailSender: {
        send: vi
          .fn()
          .mockRejectedValue(new EmailProviderError("down", { status: 502 })),
      },
    });

    otp.dispatch(await otp.issue(USER, "password_reset"));

    await vi.waitFor(() =>
      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ providerStatus: 502 }),
        "password reset code email delivery failed",
      ),
    );
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(EMAIL);
  });

  it("logs a delivered code without the address", async () => {
    const { otp, log } = setup();

    otp.dispatch(await otp.issue(USER, "password_reset"));

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
    const { otp, fake } = setup({
      ttl: { ...DEFAULT_TTL, passwordResetCodeSeconds: 45 * 60 },
    });

    otp.dispatch(await otp.issue(USER, "password_reset"));

    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    expect(fake.sent[0]?.text).toContain("45 minutes");
  });

  describe("signup codes", () => {
    const pendingUser = { users: [{ ...USER, emailVerifiedAt: null }] };

    it("emails the first signup code of a pending account", async () => {
      const { otp, stored, fake } = setup({ seed: pendingUser });

      const issued = await otp.issue(USER, "signup");
      otp.dispatch(issued);

      expect(issued).toEqual({
        userId: USER_ID,
        token: expect.any(String),
        delivery: expect.anything(),
      });
      expect(stored("signup")).toMatchObject({
        tokenHash: hashVerificationToken(issued.token),
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

    it("rotates only the token inside the cooldown", async () => {
      const { otp, stored, send } = setup({
        seed: seedWithCode("signup", { issuedAt: secondsAgo(5) }, null),
      });

      const issued = await otp.issue(USER, "signup");
      otp.dispatch(issued);

      expect(issued.delivery).toBeNull();
      expect(stored("signup")).toMatchObject({
        tokenHash: hashVerificationToken(issued.token),
        codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
        codeSendCount: 1,
        issuedAt: secondsAgo(5),
      });
      expect(send).not.toHaveBeenCalled();
    });

    it("states the configured signup ttl in the email", async () => {
      const { otp, fake } = setup({
        seed: pendingUser,
        ttl: { ...DEFAULT_TTL, signupCodeSeconds: 30 * 60 },
      });

      otp.dispatch(await otp.issue(USER, "signup"));

      await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
      expect(fake.sent[0]?.subject).toContain("verification code");
      expect(fake.sent[0]?.text).toContain("30 minutes");
    });

    it("restores the code when the first signup email fails", async () => {
      const { otp, stored } = setup({
        seed: pendingUser,
        emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
      });

      const issued = await otp.issue(USER, "signup");
      otp.dispatch(issued);

      await vi.waitFor(() => expect(stored("signup")?.codeSendCount).toBe(0));
      expect(stored("signup")?.tokenHash).toBe(
        hashVerificationToken(issued.token),
      );
    });
  });
});

describe("otp module: dispatch after a transaction", () => {
  it("compensates a failed delivery on the repository of the root, never the transaction's", async () => {
    const store = createInMemoryStore({ users: [USER] });
    const built: Array<{ executor: Executor; repo: OtpRepository }> = [];
    const factory = vi.fn((executor: Executor) => {
      const repo = { ...store.repositories.otp(executor) };
      repo.restore = vi.fn(repo.restore);
      built.push({ executor, repo });
      return repo;
    });
    const opts = makeAppOptions({
      store,
      repositories: { otp: factory },
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });
    const app = Fastify();
    await app.register(database, opts);
    await app.register(email, opts);
    await app.register(otpPlugin, opts);
    await app.ready();

    const tx = { tx: true } as unknown as Transaction;
    const issued = await app.otp.inTx(tx).issue(USER, "password_reset");
    app.otp.dispatch(issued);

    const root = built.find(({ executor }) => executor === app.db);
    const scoped = built.find(({ executor }) => executor === tx);
    await vi.waitFor(() => expect(root?.repo.restore).toHaveBeenCalledOnce());
    expect(scoped?.repo.restore).not.toHaveBeenCalled();
    expect(
      store.verificationCodes.get(`${USER_ID}:password_reset`),
    ).toMatchObject({ codeSendCount: 0 });
    await app.close();
  });

  it("offers no dispatch on a transaction-bound service", async () => {
    const opts = makeAppOptions();
    const app = Fastify();
    await app.register(database, opts);
    await app.register(email, opts);
    await app.register(otpPlugin, opts);
    await app.ready();

    const scoped = app.otp.inTx({} as Transaction);

    expect("dispatch" in scoped).toBe(false);
    await app.close();
  });
});

describe("otp service: resend", () => {
  it("rejects a token that matches no code", async () => {
    const { otp, send } = setup();

    expect(await otp.resend("signup", "unknown-token")).toBe("invalid-session");
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a token of another purpose", async () => {
    const { otp } = setup({ seed: seedWithCode("password_reset") });

    expect(await otp.resend("signup", TOKEN)).toBe("invalid-session");
  });

  it("rejects an expired code", async () => {
    const { otp, send } = setup({
      seed: seedWithCode(
        "signup",
        { issuedAt: secondsAgo(DEFAULT_TTL.signupCodeSeconds) },
        null,
      ),
    });

    expect(await otp.resend("signup", TOKEN)).toBe("invalid-session");
    expect(send).not.toHaveBeenCalled();
  });

  it("reports the cooldown and changes nothing", async () => {
    const seed = seedWithCode("signup", { issuedAt: secondsAgo(5) }, null);
    const { otp, stored, send } = setup({ seed });
    const before = { ...stored("signup") };

    expect(await otp.resend("signup", TOKEN)).toBe("cooldown");
    expect(stored("signup")).toEqual(before);
    expect(send).not.toHaveBeenCalled();
  });

  it("reports the send cap and changes nothing", async () => {
    const { otp, stored, send } = setup({
      seed: seedWithCode(
        "signup",
        { issuedAt: secondsAgo(600), codeSendCount: MAX_CODE_SEND_COUNT },
        null,
      ),
    });

    expect(await otp.resend("signup", TOKEN)).toBe("limit-reached");
    expect(stored("signup")?.codeSendCount).toBe(MAX_CODE_SEND_COUNT);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends a new code, waits for delivery and keeps the token", async () => {
    const { otp, stored, fake } = setup({
      seed: seedWithCode(
        "signup",
        { issuedAt: secondsAgo(120), codeSendCount: 2, codeAttempts: 3 },
        null,
      ),
    });

    expect(await otp.resend("signup", TOKEN)).toBe("sent");

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
    const { otp, stored } = setup({
      seed: seedWithCode(
        "signup",
        { issuedAt: secondsAgo(1), codeSendCount: 0 },
        null,
      ),
    });

    expect(await otp.resend("signup", TOKEN)).toBe("sent");
    expect(stored("signup")?.codeSendCount).toBe(1);
  });

  it("restores the previous code and reports the email as unavailable when delivery fails", async () => {
    const issuedAt = secondsAgo(120);
    const expiresAt = new Date(NOW.getTime() + 60 * 1000);
    const { otp, stored } = setup({
      seed: seedWithCode(
        "signup",
        { issuedAt, expiresAt, codeSendCount: 2, codeAttempts: 1 },
        null,
      ),
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });

    expect(await otp.resend("signup", TOKEN)).toBe("email-unavailable");
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
    const { otp, repo, log } = setup({
      seed: seedWithCode("signup", { issuedAt: secondsAgo(120) }, null),
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });
    repo.restore = vi.fn().mockRejectedValue(new Error("db down"));

    expect(await otp.resend("signup", TOKEN)).toBe("email-unavailable");
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "signup" }),
      "failed to restore verification code after resend failure",
    );
  });
});

describe("otp service: verify", () => {
  it("rejects a missing token without a lookup", async () => {
    const { otp, repo } = setup({ seed: seedWithCode("signup") });
    const lookup = vi.spyOn(repo, "findByTokenHash");

    expect(await otp.verify("signup", undefined, CODE)).toEqual({
      outcome: "invalid",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects an unknown token and logs it without the token", async () => {
    const { otp, log } = setup({ seed: seedWithCode("signup") });

    expect(await otp.verify("signup", "unknown-token", CODE)).toEqual({
      outcome: "invalid",
    });
    expect(log.info).toHaveBeenCalledWith(
      { purpose: "signup" },
      "signup code token not recognized",
    );
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("unknown-token");
  });

  it("rejects a token of another purpose", async () => {
    const { otp } = setup({ seed: seedWithCode("signup") });

    expect(await otp.verify("password_reset", TOKEN, CODE)).toEqual({
      outcome: "invalid",
    });
  });

  it("rejects an expired code, even the right one, without counting an attempt", async () => {
    const { otp, stored, log } = setup({
      seed: seedWithCode("signup", {
        issuedAt: secondsAgo(DEFAULT_TTL.signupCodeSeconds),
      }),
    });

    expect(await otp.verify("signup", TOKEN, CODE)).toEqual({
      outcome: "invalid",
    });
    expect(stored("signup")?.codeAttempts).toBe(0);
    expect(log.info).toHaveBeenCalledWith(
      { userId: USER_ID, purpose: "signup" },
      "signup code expired",
    );
  });

  it("rejects a code exactly at its stored expiry", async () => {
    const { otp } = setup({
      seed: seedWithCode("signup", {
        issuedAt: secondsAgo(60),
        expiresAt: NOW,
      }),
    });

    expect(await otp.verify("signup", TOKEN, CODE)).toEqual({
      outcome: "invalid",
    });
  });

  it("trusts the stored expiry over the configured ttl", async () => {
    const { otp } = setup({
      seed: seedWithCode("signup", {
        issuedAt: secondsAgo(120),
        expiresAt: secondsAgo(60),
      }),
      ttl: { ...DEFAULT_TTL, signupCodeSeconds: 60 * 60 },
    });

    expect(await otp.verify("signup", TOKEN, CODE)).toEqual({
      outcome: "invalid",
    });
  });

  it("keeps an exhausted code unusable even when the right code arrives", async () => {
    const { otp, stored } = setup({
      seed: seedWithCode("signup", { codeAttempts: MAX_CODE_ATTEMPTS }),
    });

    expect(await otp.verify("signup", TOKEN, CODE)).toEqual({
      outcome: "invalid",
    });
    expect(stored("signup")?.codeAttempts).toBe(MAX_CODE_ATTEMPTS);
  });

  it("counts a wrong code as an attempt and warns without the code", async () => {
    const { otp, stored, log } = setup({ seed: seedWithCode("signup") });

    expect(await otp.verify("signup", TOKEN, "000000")).toEqual({
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
    const { otp, stored, log } = setup({
      seed: seedWithCode("password_reset", {
        codeAttempts: MAX_CODE_ATTEMPTS - 1,
      }),
    });

    await otp.verify("password_reset", TOKEN, "000000");

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
    const { otp, stored } = setup({
      seed: seedWithCode("signup", { codeAttempts: 2 }),
    });

    expect(await otp.verify("signup", TOKEN, CODE)).toEqual({
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

describe("otp service: consume", () => {
  const input = {
    userId: USER_ID,
    tokenHash: hashVerificationToken(TOKEN),
    codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
  };

  it("deletes the code the caller read and reports it consumed", async () => {
    const { otp, stored } = setup({ seed: seedWithCode("password_reset") });

    expect(await otp.consume("password_reset", input)).toBe(true);
    expect(stored("password_reset")).toBeUndefined();
  });

  it("refuses a code rotated or reissued since it was read", async () => {
    const { otp, stored } = setup({ seed: seedWithCode("password_reset") });

    expect(
      await otp.consume("password_reset", { ...input, codeHash: "stale" }),
    ).toBe(false);
    expect(
      await otp.consume("password_reset", { ...input, tokenHash: "stale" }),
    ).toBe(false);
    expect(stored("password_reset")).toBeDefined();
  });

  it("refuses a code of another purpose", async () => {
    const { otp, stored } = setup({ seed: seedWithCode("password_reset") });

    expect(await otp.consume("signup", input)).toBe(false);
    expect(stored("password_reset")).toBeDefined();
  });
});

describe("otp service: purgeExpired", () => {
  it("deletes the codes expired at the instant and counts them", async () => {
    const { otp, store } = setup({
      seed: {
        users: [USER],
        verificationCodes: [
          { userId: USER_ID, purpose: "signup", issuedAt: NOW, expiresAt: NOW },
          {
            userId: USER_ID,
            purpose: "password_reset",
            issuedAt: NOW,
            expiresAt: new Date(NOW.getTime() + 1000),
          },
        ],
      },
    });

    expect(await otp.purgeExpired(NOW)).toBe(1);
    expect([...store.verificationCodes.keys()]).toEqual([
      `${USER_ID}:password_reset`,
    ]);
  });
});
