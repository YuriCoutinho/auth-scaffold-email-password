import { describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "../../../../src/lib/password.js";
import { hashOtpCode } from "../../../../src/lib/token-hash.js";
import { createResetPasswordService } from "../../../../src/plugins/app/auth/reset-password.js";
import { FakeEmailSender } from "../../../../src/plugins/app/email/drivers/fake.js";
import { createInMemoryAuthRepository } from "../../../helpers/auth/in-memory-repository.js";

const NOW = new Date("2026-01-01T12:00:00Z");
const CODE = "123456";
const NEW_PASSWORD = "a-brand-new-passphrase";
const OLD_PASSWORD = "the-previous-passphrase";

async function setup(
  overrides: { checkPwnedPassword?: () => Promise<boolean> } = {},
) {
  const repo = createInMemoryAuthRepository({
    authUsers: [
      {
        id: 1,
        email: "reset@example.com",
        passwordHash: await hashPassword(OLD_PASSWORD),
      },
    ],
    sessions: [
      {
        id: 10,
        userId: 1,
        tokenHash: "old-session",
        expiresAt: new Date(NOW.getTime() + 86_400_000),
      },
    ],
  });
  await repo.upsertPasswordReset({
    userId: 1,
    codeHash: hashOtpCode(CODE),
    resetSessionToken: "tok",
    expiresAt: new Date(NOW.getTime() + 600_000),
    now: NOW,
  });
  const emailSender = new FakeEmailSender();
  const checkPwnedPassword =
    overrides.checkPwnedPassword ?? vi.fn().mockResolvedValue(false);
  const { resetPassword } = createResetPasswordService({
    repo,
    emailSender,
    checkPwnedPassword,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => NOW,
  });
  return { repo, emailSender, checkPwnedPassword, resetPassword };
}

const input = {
  sessionToken: "tok",
  code: CODE,
  newPassword: NEW_PASSWORD,
  deviceLabel: null,
};

describe("resetPassword", () => {
  it("stores the new password, drops the row and opens a session", async () => {
    const { repo, resetPassword } = await setup();

    const result = await resetPassword(input);

    expect(result).toMatchObject({ outcome: "reset" });
    if (result.outcome !== "reset") return;
    expect(result.sessionToken).toBeTruthy();

    const user = await repo.findAuthUserCredentialsById(1);
    expect(await verifyPassword(user?.passwordHash ?? "", NEW_PASSWORD)).toBe(
      true,
    );
    expect(await repo.findPasswordResetBySessionToken("tok")).toBeUndefined();
  });

  it("revokes every existing session with the password_reset reason", async () => {
    const { repo, resetPassword } = await setup();

    await resetPassword(input);

    const old = repo.sessions.find((s) => s.tokenHash === "old-session");
    expect(old?.revokedAt).toEqual(NOW);
    expect(old?.revokedReason).toBe("password_reset");
  });

  it("leaves the session it just opened active", async () => {
    const { repo, resetPassword } = await setup();

    await resetPassword(input);

    const active = repo.sessions.filter((s) => s.revokedAt === null);
    expect(active).toHaveLength(1);
  });

  it("sends the password changed notice", async () => {
    const { emailSender, resetPassword } = await setup();

    await resetPassword(input);

    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));
    expect(emailSender.sent[0]?.subject).toBe("Your password was changed");
  });

  it("rejects a missing cookie without touching the repository", async () => {
    const { repo, resetPassword } = await setup();

    const result = await resetPassword({ ...input, sessionToken: undefined });

    expect(result).toEqual({ outcome: "invalid" });
    expect(await repo.findPasswordResetBySessionToken("tok")).toBeDefined();
  });

  it("rejects a token that matches no row, which is what an unknown address gets", async () => {
    const { resetPassword } = await setup();

    expect(
      await resetPassword({ ...input, sessionToken: "throwaway-token" }),
    ).toEqual({ outcome: "invalid" });
  });

  it("rejects an expired reset", async () => {
    const { repo, resetPassword } = await setup();
    await repo.updatePasswordResetSendState("tok", {
      resetSessionToken: "tok",
      codeHash: hashOtpCode(CODE),
      expiresAt: new Date(NOW.getTime() - 1_000),
      codeAttempts: 0,
      lastSentAt: NOW,
      codeSendCount: 1,
    });

    expect(await resetPassword(input)).toEqual({ outcome: "invalid" });
  });

  it("counts a wrong code as an attempt", async () => {
    const { repo, resetPassword } = await setup();

    expect(await resetPassword({ ...input, code: "000000" })).toEqual({
      outcome: "invalid",
    });
    expect((await repo.findPasswordResetByUserId(1))?.codeAttempts).toBe(1);
  });

  it("keeps an exhausted code unusable even when the right one arrives", async () => {
    const { repo, resetPassword } = await setup();
    await repo.updatePasswordResetSendState("tok", {
      resetSessionToken: "tok",
      codeHash: hashOtpCode(CODE),
      expiresAt: new Date(NOW.getTime() + 600_000),
      codeAttempts: 5,
      lastSentAt: NOW,
      codeSendCount: 1,
    });

    expect(await resetPassword(input)).toEqual({ outcome: "invalid" });
    const user = await repo.findAuthUserCredentialsById(1);
    expect(await verifyPassword(user?.passwordHash ?? "", NEW_PASSWORD)).toBe(
      false,
    );
  });

  it("refuses a new password equal to the current one, without burning the code", async () => {
    const { repo, resetPassword } = await setup();

    const result = await resetPassword({ ...input, newPassword: OLD_PASSWORD });

    expect(result).toEqual({ outcome: "same-password" });
    const stored = await repo.findPasswordResetByUserId(1);
    expect(stored).toBeDefined();
    expect(stored?.codeAttempts).toBe(0);
  });

  it("refuses a breached password, without burning the code", async () => {
    const { repo, resetPassword } = await setup({
      checkPwnedPassword: vi.fn().mockResolvedValue(true),
    });

    const result = await resetPassword(input);

    expect(result).toEqual({ outcome: "pwned-password" });
    const stored = await repo.findPasswordResetByUserId(1);
    expect(stored).toBeDefined();
    expect(stored?.codeAttempts).toBe(0);
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

  it("sends no notice on any refusal", async () => {
    const { emailSender, resetPassword } = await setup();

    await resetPassword({ ...input, code: "000000" });
    await resetPassword({ ...input, newPassword: OLD_PASSWORD });

    expect(emailSender.sent).toHaveLength(0);
  });
});
