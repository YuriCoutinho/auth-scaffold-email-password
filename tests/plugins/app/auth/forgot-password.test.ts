import { describe, expect, it, vi } from "vitest";
import { createForgotPasswordService } from "../../../../src/plugins/app/auth/forgot-password.js";
import { FakeEmailSender } from "../../../../src/plugins/app/email/drivers/fake.js";
import { createInMemoryAuthRepository } from "../../../helpers/auth/in-memory-repository.js";

const NOW = new Date("2026-01-01T12:00:00Z");

function setup(seed = {}) {
  const repo = createInMemoryAuthRepository({
    authUsers: [{ id: 1, email: "reset@example.com", passwordHash: "old" }],
    ...seed,
  });
  const emailSender = new FakeEmailSender();
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const { forgotPassword } = createForgotPasswordService({
    repo,
    emailSender,
    log,
    now: () => NOW,
  });
  return { repo, emailSender, log, forgotPassword };
}

describe("forgotPassword", () => {
  it("creates a reset row and emails the code for a known address", async () => {
    const { repo, emailSender, forgotPassword } = setup();

    const { sessionToken } = await forgotPassword("reset@example.com");

    expect(sessionToken).toBeTruthy();
    const stored = await repo.findPasswordResetBySessionToken(sessionToken);
    expect(stored).toMatchObject({
      userId: 1,
      codeAttempts: 0,
      codeSendCount: 1,
    });
    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));
    expect(emailSender.sent[0]?.to).toBe("reset@example.com");
  });

  it("normalizes the address before looking the account up", async () => {
    const { repo, forgotPassword } = setup();

    const { sessionToken } = await forgotPassword("  RESET@Example.com  ");

    expect(
      await repo.findPasswordResetBySessionToken(sessionToken),
    ).toBeDefined();
  });

  it("hands back a throwaway token and writes nothing for an unknown address", async () => {
    const { repo, emailSender, forgotPassword } = setup();

    const { sessionToken } = await forgotPassword("nobody@example.com");

    expect(sessionToken).toBeTruthy();
    expect(
      await repo.findPasswordResetBySessionToken(sessionToken),
    ).toBeUndefined();
    expect(repo.passwordResets.size).toBe(0);
    expect(emailSender.sent).toHaveLength(0);
  });

  it("does not wait for the provider before returning", async () => {
    const { repo } = setup();
    let release: () => void = () => {};
    const emailSender = {
      send: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ providerMessageId: "late" });
          }),
      ),
    };
    const { forgotPassword } = createForgotPasswordService({
      repo,
      emailSender,
      now: () => NOW,
    });

    await expect(forgotPassword("reset@example.com")).resolves.toMatchObject({
      sessionToken: expect.any(String),
    });
    expect(emailSender.send).toHaveBeenCalledTimes(1);
    release();
  });

  it("resends with a fresh code once the cooldown has passed", async () => {
    const { repo, emailSender, forgotPassword } = setup();
    await repo.upsertPasswordReset({
      userId: 1,
      codeHash: "old-code",
      resetSessionToken: "tok",
      expiresAt: new Date(NOW.getTime() + 60_000),
      now: new Date(NOW.getTime() - 120_000),
    });

    const { sessionToken } = await forgotPassword("reset@example.com");

    const stored = await repo.findPasswordResetByUserId(1);
    expect(stored?.codeHash).not.toBe("old-code");
    expect(stored?.codeSendCount).toBe(2);
    expect(stored?.codeAttempts).toBe(0);
    expect(sessionToken).toBe(stored?.resetSessionToken);
    expect(sessionToken).not.toBe("tok");
    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));
  });

  it("sends nothing inside the cooldown, rotating the token and nothing else", async () => {
    const { repo, emailSender, forgotPassword } = setup();
    const lastSentAt = new Date(NOW.getTime() - 5_000);
    await repo.upsertPasswordReset({
      userId: 1,
      codeHash: "old-code",
      resetSessionToken: "tok",
      expiresAt: new Date(NOW.getTime() + 60_000),
      now: lastSentAt,
    });

    const { sessionToken } = await forgotPassword("reset@example.com");

    expect(sessionToken).not.toBe("tok");
    expect(emailSender.sent).toHaveLength(0);
    const stored = await repo.findPasswordResetByUserId(1);
    expect(stored).toMatchObject({
      resetSessionToken: sessionToken,
      codeHash: "old-code",
      codeAttempts: 0,
      codeSendCount: 1,
      lastSentAt,
    });
    expect(await repo.findPasswordResetBySessionToken("tok")).toBeUndefined();
  });

  it("sends nothing once the send cap is reached, rotating the token and nothing else", async () => {
    const { repo, emailSender, forgotPassword } = setup();
    await repo.upsertPasswordReset({
      userId: 1,
      codeHash: "old-code",
      resetSessionToken: "tok",
      expiresAt: new Date(NOW.getTime() + 60_000),
      now: new Date(NOW.getTime() - 600_000),
    });
    await repo.updatePasswordResetSendState("tok", {
      resetSessionToken: "tok",
      codeHash: "old-code",
      expiresAt: new Date(NOW.getTime() + 60_000),
      codeAttempts: 0,
      lastSentAt: new Date(NOW.getTime() - 600_000),
      codeSendCount: 5,
    });

    const { sessionToken } = await forgotPassword("reset@example.com");

    expect(sessionToken).not.toBe("tok");
    expect(emailSender.sent).toHaveLength(0);
    expect(await repo.findPasswordResetByUserId(1)).toMatchObject({
      resetSessionToken: sessionToken,
      codeHash: "old-code",
      codeAttempts: 0,
      codeSendCount: 5,
      lastSentAt: new Date(NOW.getTime() - 600_000),
    });
  });

  it("starts a fresh row when the previous reset has expired", async () => {
    const { repo, forgotPassword } = setup();
    await repo.upsertPasswordReset({
      userId: 1,
      codeHash: "old-code",
      resetSessionToken: "tok",
      expiresAt: new Date(NOW.getTime() - 1_000),
      now: new Date(NOW.getTime() - 900_000),
    });

    const { sessionToken } = await forgotPassword("reset@example.com");

    expect(sessionToken).not.toBe("tok");
    expect((await repo.findPasswordResetByUserId(1))?.codeSendCount).toBe(1);
  });

  it("restores the previous state when delivery fails, without refunding the whole quota", async () => {
    const { repo } = setup();
    const previousSentAt = new Date(NOW.getTime() - 600_000);
    await repo.upsertPasswordReset({
      userId: 1,
      codeHash: "third-code",
      resetSessionToken: "tok",
      expiresAt: new Date(NOW.getTime() + 60_000),
      now: previousSentAt,
    });
    await repo.updatePasswordResetSendState("tok", {
      resetSessionToken: "tok",
      codeHash: "third-code",
      expiresAt: new Date(NOW.getTime() + 60_000),
      codeAttempts: 2,
      lastSentAt: previousSentAt,
      codeSendCount: 3,
    });
    const emailSender = { send: vi.fn().mockRejectedValue(new Error("down")) };
    const { forgotPassword } = createForgotPasswordService({
      repo,
      emailSender,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => NOW,
    });

    await forgotPassword("reset@example.com");

    await vi.waitFor(async () => {
      const stored = await repo.findPasswordResetByUserId(1);
      expect(stored?.codeSendCount).toBe(3);
    });
    const stored = await repo.findPasswordResetByUserId(1);
    expect(stored?.codeHash).toBe("third-code");
    expect(stored?.codeAttempts).toBe(2);
    expect(stored?.lastSentAt).toEqual(previousSentAt);
  });

  it("restores a brand new row to an uncharged send when delivery fails", async () => {
    const { repo } = setup();
    const emailSender = { send: vi.fn().mockRejectedValue(new Error("down")) };
    const { forgotPassword } = createForgotPasswordService({
      repo,
      emailSender,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => NOW,
    });

    await forgotPassword("reset@example.com");

    await vi.waitFor(async () => {
      expect((await repo.findPasswordResetByUserId(1))?.codeSendCount).toBe(0);
    });
  });

  it("hands out a different token on every call for the same account", async () => {
    const { repo, forgotPassword } = setup();

    const first = await forgotPassword("reset@example.com");
    const second = await forgotPassword("reset@example.com");

    expect(second.sessionToken).not.toBe(first.sessionToken);
    expect(repo.passwordResets.size).toBe(1);
    expect(
      await repo.findPasswordResetBySessionToken(first.sessionToken),
    ).toBeUndefined();
    expect(
      await repo.findPasswordResetBySessionToken(second.sessionToken),
    ).toMatchObject({ userId: 1 });
  });
});
