import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../../../../src/lib/password.js";
import { createChangePasswordService } from "../../../../src/plugins/app/auth/change-password.js";

const NOW = new Date("2026-03-01T12:00:00.000Z");
const CURRENT = "current-password-here";
const NEXT = "a-brand-new-long-password";

let currentHash: string;

beforeEach(async () => {
  currentHash = await hashPassword(CURRENT);
});

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    repo: {
      findAuthUserCredentialsById: vi.fn().mockResolvedValue({
        id: 1,
        email: "owner@example.com",
        passwordHash: currentHash,
      }),
      changeUserPassword: vi.fn().mockResolvedValue(undefined),
    },
    emailSender: {
      send: vi.fn().mockResolvedValue({ providerMessageId: "x" }),
    },
    checkPwnedPassword: vi.fn().mockResolvedValue(false),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => NOW,
    ...overrides,
  };
}

const input = {
  userId: 1,
  currentSessionId: 10,
  currentPassword: CURRENT,
  newPassword: NEXT,
};

describe("changePassword", () => {
  it("stores a new hash and revokes the other sessions", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await expect(changePassword(input)).resolves.toEqual({
      outcome: "changed",
    });
    expect(deps.repo.changeUserPassword).toHaveBeenCalledWith({
      userId: 1,
      passwordHash: expect.stringMatching(/^\$argon2id\$/),
      revokedAt: NOW,
      revokedReason: "password_changed",
      exceptSessionId: 10,
    });
  });

  it("never stores the new password in clear text", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await changePassword(input);

    const call = deps.repo.changeUserPassword.mock.calls[0]?.[0];
    expect(call.passwordHash).not.toBe(NEXT);
  });

  it("rejects a wrong current password without writing anything", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await expect(
      changePassword({ ...input, currentPassword: "wrong-password-entirely" }),
    ).resolves.toEqual({ outcome: "invalid-current-password" });
    expect(deps.repo.changeUserPassword).not.toHaveBeenCalled();
  });

  it("checks the current password before the breach database", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await changePassword({
      ...input,
      currentPassword: "wrong-password-entirely",
    });

    expect(deps.checkPwnedPassword).not.toHaveBeenCalled();
  });

  it("reports the wrong current password even when the new one equals it", async () => {
    const deps = makeDeps({
      repo: {
        findAuthUserCredentialsById: vi.fn().mockResolvedValue({
          id: 1,
          email: "owner@example.com",
          passwordHash: await hashPassword("something-else-entirely"),
        }),
        changeUserPassword: vi.fn().mockResolvedValue(undefined),
      },
    });
    const { changePassword } = createChangePasswordService(deps);

    await expect(
      changePassword({ ...input, newPassword: CURRENT }),
    ).resolves.toEqual({ outcome: "invalid-current-password" });
  });

  it("rejects a new password equal to the current one", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await expect(
      changePassword({ ...input, newPassword: CURRENT }),
    ).resolves.toEqual({ outcome: "same-password" });
    expect(deps.repo.changeUserPassword).not.toHaveBeenCalled();
  });

  it("rejects a new password found in a breach", async () => {
    const deps = makeDeps({
      checkPwnedPassword: vi.fn().mockResolvedValue(true),
    });
    const { changePassword } = createChangePasswordService(deps);

    await expect(changePassword(input)).resolves.toEqual({
      outcome: "pwned-password",
    });
    expect(deps.repo.changeUserPassword).not.toHaveBeenCalled();
  });

  it("asks the breach checker about the new password and proceeds on false", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await expect(changePassword(input)).resolves.toEqual({
      outcome: "changed",
    });
    expect(deps.checkPwnedPassword).toHaveBeenCalledWith(NEXT);
  });

  it("sends the notification email to the account address", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await changePassword(input);

    expect(deps.emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner@example.com" }),
    );
  });

  it("still succeeds when the notification email fails", async () => {
    const deps = makeDeps({
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });
    const { changePassword } = createChangePasswordService(deps);

    await expect(changePassword(input)).resolves.toEqual({
      outcome: "changed",
    });
  });

  it("sends no notification when the current password is wrong", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await changePassword({
      ...input,
      currentPassword: "wrong-password-entirely",
    });

    expect(deps.emailSender.send).not.toHaveBeenCalled();
  });

  it("sends no notification when the new password equals the current one", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await changePassword({ ...input, newPassword: CURRENT });

    expect(deps.emailSender.send).not.toHaveBeenCalled();
  });

  it("sends no notification when the new password is found in a breach", async () => {
    const deps = makeDeps({
      checkPwnedPassword: vi.fn().mockResolvedValue(true),
    });
    const { changePassword } = createChangePasswordService(deps);

    await changePassword(input);

    expect(deps.emailSender.send).not.toHaveBeenCalled();
  });

  it("logs a failed attempt without the password", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await changePassword({ ...input, currentPassword: "wrong-password-here" });

    expect(deps.log.warn).toHaveBeenCalled();
    expect(JSON.stringify(deps.log.warn.mock.calls)).not.toContain(
      "wrong-password-here",
    );
  });

  it("works without a logger", async () => {
    const deps = makeDeps({ log: undefined });
    const { changePassword } = createChangePasswordService(deps);

    await expect(changePassword(input)).resolves.toEqual({
      outcome: "changed",
    });
  });
});
