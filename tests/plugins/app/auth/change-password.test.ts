import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../../../../src/lib/password.js";
import { createChangePasswordService } from "../../../../src/plugins/app/auth/change-password.js";
import { PASSWORD_CHANGED_EMAIL_TYPE } from "../../../../src/plugins/app/auth/emails/password-changed.js";
import { createInMemoryAuthRepository } from "../../../helpers/auth/in-memory-repository.js";

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
      message: expect.objectContaining({
        type: PASSWORD_CHANGED_EMAIL_TYPE,
        recipient: "owner@example.com",
      }),
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

  it("queues the notification email in the same write as the password change", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await changePassword(input);

    const call = deps.repo.changeUserPassword.mock.calls[0]?.[0];
    expect(call.message.recipient).toBe("owner@example.com");
    expect(call.message.subject).toBe("Your password was changed");
    expect(call.message.html).not.toContain(NEXT);
    expect(call.message.text).not.toContain(NEXT);
  });

  // Over the in-memory repository, so these assert on the queue itself and not
  // on a method that a future refactor could stop going through.
  describe("nothing is queued unless the password actually changes", () => {
    function makeRepoBackedDeps(overrides: Record<string, unknown> = {}) {
      const repo = createInMemoryAuthRepository({
        authUsers: [
          { id: 1, email: "owner@example.com", passwordHash: currentHash },
        ],
      });
      return {
        repo,
        deps: {
          repo,
          checkPwnedPassword: vi.fn().mockResolvedValue(false),
          now: () => NOW,
          ...overrides,
        },
      };
    }

    it("queues exactly one message when it does change", async () => {
      const { repo, deps } = makeRepoBackedDeps();

      await expect(
        createChangePasswordService(deps).changePassword(input),
      ).resolves.toEqual({ outcome: "changed" });

      expect(repo.outbox.messages).toHaveLength(1);
      expect(repo.outbox.messages[0]).toMatchObject({
        type: PASSWORD_CHANGED_EMAIL_TYPE,
        recipient: "owner@example.com",
      });
    });

    it("queues nothing when the current password is wrong", async () => {
      const { repo, deps } = makeRepoBackedDeps();

      await createChangePasswordService(deps).changePassword({
        ...input,
        currentPassword: "wrong-password-entirely",
      });

      expect(repo.outbox.messages).toHaveLength(0);
    });

    it("queues nothing when the new password equals the current one", async () => {
      const { repo, deps } = makeRepoBackedDeps();

      await createChangePasswordService(deps).changePassword({
        ...input,
        newPassword: CURRENT,
      });

      expect(repo.outbox.messages).toHaveLength(0);
    });

    it("queues nothing when the new password is found in a breach", async () => {
      const { repo, deps } = makeRepoBackedDeps({
        checkPwnedPassword: vi.fn().mockResolvedValue(true),
      });

      await createChangePasswordService(deps).changePassword(input);

      expect(repo.outbox.messages).toHaveLength(0);
    });
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
