import { describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "../../../../src/lib/password.js";
import {
  hashOtpCode,
  hashSessionToken,
  hashVerificationToken,
} from "../../../../src/lib/token-hash.js";
import { DEFAULT_TTL } from "../../../../src/lib/ttl.js";
import { createResetPasswordService } from "../../../../src/plugins/app/auth/reset-password.js";
import type { VerificationCodes } from "../../../../src/plugins/app/auth/verification-codes.js";
import { createVerificationCodes } from "../../../../src/plugins/app/auth/verification-codes.js";
import { FakeEmailSender } from "../../../../src/plugins/email/drivers/fake.js";
import { TEST_HMAC_SECRET } from "../../../helpers/app-options.js";
import { createInMemoryStore } from "../../../helpers/in-memory-store.js";

const SESSION_TTL_SECONDS = 60 * 60;
const NOW = new Date("2026-09-24T12:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const EMAIL = "reset@example.com";
const TOKEN = "reset-token";
const CODE = "123456";
const NEW_PASSWORD = "a-brand-new-passphrase";
const OLD_PASSWORD = "the-previous-passphrase";
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function setup(
  options: {
    checkPwnedPassword?: () => Promise<boolean>;
    issuedAt?: Date;
    codeAttempts?: number;
    wrapCodes?: (codes: VerificationCodes) => Pick<VerificationCodes, "verify">;
  } = {},
) {
  const store = createInMemoryStore({
    users: [
      {
        id: USER_ID,
        email: EMAIL,
        passwordHash: await hashPassword(OLD_PASSWORD),
      },
      { id: OTHER_USER_ID, email: "other@example.com" },
    ],
    verificationCodes: [
      {
        userId: USER_ID,
        purpose: "password_reset",
        tokenHash: hashVerificationToken(TOKEN),
        codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
        codeAttempts: options.codeAttempts ?? 0,
        issuedAt: options.issuedAt ?? NOW,
      },
    ],
    sessions: [
      { userId: USER_ID, tokenHash: "laptop", createdAt: NOW },
      { userId: USER_ID, tokenHash: "phone", createdAt: NOW },
      { userId: OTHER_USER_ID, tokenHash: "someone-else", createdAt: NOW },
    ],
  });
  const repo = store.legacy;
  const emailSender = new FakeEmailSender();
  // Spied so the "no notice" case can assert synchronously, instead of reading
  // a list that a detached send may not have filled yet.
  const send = vi.spyOn(emailSender, "send");
  const checkPwnedPassword =
    options.checkPwnedPassword ?? vi.fn().mockResolvedValue(false);
  const throttle = {
    check: vi.fn().mockResolvedValue({ outcome: "allowed" as const }),
    registerFailure: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    purgeStale: vi.fn().mockResolvedValue(0),
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const codes = createVerificationCodes({
    hmacSecret: TEST_HMAC_SECRET,
    repo,
    emailSender,
    ttl: DEFAULT_TTL,
    log,
    now: () => NOW,
  });
  const { resetPassword } = createResetPasswordService({
    repo,
    sessionTtlSeconds: SESSION_TTL_SECONDS,
    codes: options.wrapCodes ? options.wrapCodes(codes) : codes,
    emailSender,
    checkPwnedPassword,
    throttle,
    log,
    now: () => NOW,
  });
  const code = () => store.verificationCodes.get(`${USER_ID}:password_reset`);
  const passwordIs = async (password: string) =>
    verifyPassword(store.users.get(USER_ID)?.passwordHash ?? "", password);
  const sessionsOf = (userId: string) =>
    [...store.sessions.values()].filter((session) => session.userId === userId);
  return {
    store,
    repo,
    emailSender,
    send,
    checkPwnedPassword,
    throttle,
    log,
    resetPassword,
    code,
    passwordIs,
    sessionsOf,
  };
}

const input = {
  sessionToken: TOKEN,
  code: CODE,
  newPassword: NEW_PASSWORD,
  deviceLabel: "Safari on iOS",
};

describe("resetPassword", () => {
  it("stores the new password and consumes the code", async () => {
    const { resetPassword, code, passwordIs } = await setup();

    const result = await resetPassword(input);

    expect(result).toEqual({
      outcome: "reset",
      sessionToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(await passwordIs(NEW_PASSWORD)).toBe(true);
    expect(code()).toBeUndefined();
  });

  it("deletes every session of the account and opens exactly one new one", async () => {
    const { resetPassword, sessionsOf } = await setup();

    const result = await resetPassword(input);
    if (result.outcome !== "reset") throw new Error("expected a reset");

    expect(sessionsOf(USER_ID)).toEqual([
      {
        id: expect.stringMatching(UUID_V4),
        userId: USER_ID,
        tokenHash: hashSessionToken(result.sessionToken),
        deviceLabel: "Safari on iOS",
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + SESSION_TTL_SECONDS * 1000),
      },
    ]);
    expect(sessionsOf(OTHER_USER_ID)).toHaveLength(1);
  });

  it("sends the password changed notice", async () => {
    const { emailSender, resetPassword } = await setup();

    await resetPassword(input);

    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));
    expect(emailSender.sent[0]?.to).toBe(EMAIL);
    expect(emailSender.sent[0]?.subject).toBe("Your password was changed");
  });

  it("still resets when the notice fails to go out", async () => {
    const { emailSender, resetPassword, passwordIs } = await setup();
    vi.spyOn(emailSender, "send").mockRejectedValue(new Error("down"));

    expect((await resetPassword(input)).outcome).toBe("reset");
    expect(await passwordIs(NEW_PASSWORD)).toBe(true);
  });

  it("rejects a missing cookie and leaves everything in place", async () => {
    const { resetPassword, code, sessionsOf } = await setup();

    expect(await resetPassword({ ...input, sessionToken: undefined })).toEqual({
      outcome: "invalid",
    });
    expect(code()).toBeDefined();
    expect(sessionsOf(USER_ID)).toHaveLength(2);
  });

  it("rejects a token that matches no code, which is what an unknown address gets", async () => {
    const { resetPassword, passwordIs } = await setup();

    expect(
      await resetPassword({ ...input, sessionToken: "throwaway-token" }),
    ).toEqual({ outcome: "invalid" });
    expect(await passwordIs(OLD_PASSWORD)).toBe(true);
  });

  it("rejects an expired code", async () => {
    const { resetPassword, passwordIs } = await setup({
      issuedAt: new Date(
        NOW.getTime() - DEFAULT_TTL.passwordResetCodeSeconds * 1000,
      ),
    });

    expect(await resetPassword(input)).toEqual({ outcome: "invalid" });
    expect(await passwordIs(OLD_PASSWORD)).toBe(true);
  });

  it("counts a wrong code as an attempt", async () => {
    const { resetPassword, code, sessionsOf } = await setup();

    expect(await resetPassword({ ...input, code: "000000" })).toEqual({
      outcome: "invalid",
    });
    expect(code()?.codeAttempts).toBe(1);
    expect(sessionsOf(USER_ID)).toHaveLength(2);
  });

  it("keeps an exhausted code unusable even when the right one arrives", async () => {
    const { resetPassword, passwordIs } = await setup({ codeAttempts: 5 });

    expect(await resetPassword(input)).toEqual({ outcome: "invalid" });
    expect(await passwordIs(NEW_PASSWORD)).toBe(false);
  });

  it("refuses a new password equal to the current one, without burning the code", async () => {
    const { resetPassword, code } = await setup();

    expect(
      await resetPassword({ ...input, newPassword: OLD_PASSWORD }),
    ).toEqual({ outcome: "same-password" });
    expect(code()).toMatchObject({ codeAttempts: 0 });
  });

  it("refuses a breached password, without burning the code", async () => {
    const { resetPassword, code } = await setup({
      checkPwnedPassword: vi.fn().mockResolvedValue(true),
    });

    expect(await resetPassword(input)).toEqual({ outcome: "pwned-password" });
    expect(code()).toMatchObject({ codeAttempts: 0 });
  });

  it("checks the code before spending the breach lookup", async () => {
    const { checkPwnedPassword, resetPassword } = await setup();

    await resetPassword({ ...input, code: "000000" });

    expect(checkPwnedPassword).not.toHaveBeenCalled();
  });

  it("checks the current password before spending the breach lookup", async () => {
    const { checkPwnedPassword, resetPassword } = await setup();

    await resetPassword({ ...input, newPassword: OLD_PASSWORD });

    expect(checkPwnedPassword).not.toHaveBeenCalled();
  });

  it("loses when the token is rotated between the check and the reset", async () => {
    const { repo, send, throttle, log, resetPassword, passwordIs, sessionsOf } =
      await setup({
        wrapCodes: (codes) => ({
          async verify(...args) {
            const result = await codes.verify(...args);
            // A new forgot-password request lands in between.
            await repo.rotateVerificationToken(
              { userId: USER_ID, purpose: "password_reset" },
              hashVerificationToken("a-newer-token"),
            );
            return result;
          },
        }),
      });

    expect(await resetPassword(input)).toEqual({ outcome: "invalid" });
    expect(await passwordIs(OLD_PASSWORD)).toBe(true);
    expect(sessionsOf(USER_ID)).toHaveLength(2);
    expect(throttle.reset).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      { userId: USER_ID },
      "password reset code already consumed by a concurrent request",
    );
  });

  it("sends no notice on any refusal", async () => {
    const { send, resetPassword } = await setup();

    await resetPassword({ ...input, code: "000000" });
    await resetPassword({ ...input, newPassword: OLD_PASSWORD });

    expect(send).not.toHaveBeenCalled();
  });
});

describe("resetPassword throttling", () => {
  it("clears the credential throttle for the account it just unlocked", async () => {
    const { throttle, resetPassword } = await setup();

    await resetPassword(input);

    expect(throttle.reset).toHaveBeenCalledWith(EMAIL);
  });

  it("leaves the throttle alone when the code is wrong", async () => {
    const { throttle, resetPassword } = await setup();

    await resetPassword({ ...input, code: "000000" });

    expect(throttle.reset).not.toHaveBeenCalled();
  });

  it("leaves the throttle alone when the code has expired", async () => {
    const { throttle, resetPassword } = await setup({
      issuedAt: new Date(
        NOW.getTime() - DEFAULT_TTL.passwordResetCodeSeconds * 1000,
      ),
    });

    await resetPassword(input);

    expect(throttle.reset).not.toHaveBeenCalled();
  });
});
