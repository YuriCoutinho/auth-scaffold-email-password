import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../../../../src/lib/password.js";
import { createChangePasswordService } from "../../../../src/plugins/app/auth/change-password.js";
import { createInMemoryAuthRepository } from "../../../helpers/auth/in-memory-repository.js";

// A spy over the real implementation: the existing tests still hash and verify
// for real, and a test can still assert the verification was never spent.
vi.mock("../../../../src/lib/password.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/lib/password.js")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});
const { verifyPassword } = await import("../../../../src/lib/password.js");
const verifyPasswordMock = vi.mocked(verifyPassword);

const CURRENT = "current-password-here";
const NEXT = "a-brand-new-long-password";

let currentHash: string;

beforeEach(async () => {
  verifyPasswordMock.mockClear();
  currentHash = await hashPassword(CURRENT);
});

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const CURRENT_SESSION_ID = "33333333-3333-4333-8333-333333333333";

function makeDeps(
  overrides: Record<string, unknown> = {},
  options: { email?: string; passwordHash?: string } = {},
) {
  const repo = createInMemoryAuthRepository({
    users: [
      {
        id: USER_ID,
        email: options.email ?? "owner@example.com",
        passwordHash: options.passwordHash ?? currentHash,
      },
      { id: OTHER_USER_ID, email: "other@example.com" },
    ],
    sessions: [
      { id: CURRENT_SESSION_ID, userId: USER_ID, tokenHash: "current" },
      { userId: USER_ID, tokenHash: "laptop" },
      { userId: USER_ID, tokenHash: "phone" },
      { userId: OTHER_USER_ID, tokenHash: "someone-else" },
    ],
  });
  return {
    repo,
    emailSender: {
      send: vi.fn().mockResolvedValue({ providerMessageId: "x" }),
    },
    checkPwnedPassword: vi.fn().mockResolvedValue(false),
    throttle: {
      check: vi.fn().mockResolvedValue({ outcome: "allowed" }),
      registerFailure: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

const storedHash = (deps: ReturnType<typeof makeDeps>) =>
  deps.repo.users.get(USER_ID)?.passwordHash ?? "";

const sessionIdsOf = (deps: ReturnType<typeof makeDeps>, userId: string) =>
  [...deps.repo.sessions.values()]
    .filter((session) => session.userId === userId)
    .map((session) => session.id);

const input = {
  userId: USER_ID,
  currentSessionId: CURRENT_SESSION_ID,
  currentPassword: CURRENT,
  newPassword: NEXT,
};

describe("changePassword", () => {
  it("stores a new argon2 hash of the new password", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await expect(changePassword(input)).resolves.toEqual({
      outcome: "changed",
    });
    expect(storedHash(deps)).toMatch(/^\$argon2id\$/);
    expect(storedHash(deps)).not.toContain(NEXT);
    expect(await verifyPassword(storedHash(deps), NEXT)).toBe(true);
  });

  it("deletes every other session of the account and keeps the current one", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await changePassword(input);

    expect(sessionIdsOf(deps, USER_ID)).toEqual([CURRENT_SESSION_ID]);
    expect(sessionIdsOf(deps, OTHER_USER_ID)).toHaveLength(1);
  });

  it("rejects an account that no longer exists as a wrong current password", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await expect(
      changePassword({
        ...input,
        userId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({ outcome: "invalid-current-password" });
    expect(deps.checkPwnedPassword).not.toHaveBeenCalled();
    expect(deps.throttle.check).not.toHaveBeenCalled();
  });

  it("rejects a wrong current password without writing anything", async () => {
    const deps = makeDeps();
    const { changePassword } = createChangePasswordService(deps);

    await expect(
      changePassword({ ...input, currentPassword: "wrong-password-entirely" }),
    ).resolves.toEqual({ outcome: "invalid-current-password" });
    expect(storedHash(deps)).toBe(currentHash);
    expect(sessionIdsOf(deps, USER_ID)).toHaveLength(3);
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
    const deps = makeDeps(
      {},
      { passwordHash: await hashPassword("something-else-entirely") },
    );
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
    expect(storedHash(deps)).toBe(currentHash);
  });

  it("rejects a new password found in a breach", async () => {
    const deps = makeDeps({
      checkPwnedPassword: vi.fn().mockResolvedValue(true),
    });
    const { changePassword } = createChangePasswordService(deps);

    await expect(changePassword(input)).resolves.toEqual({
      outcome: "pwned-password",
    });
    expect(storedHash(deps)).toBe(currentHash);
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

    await vi.waitFor(() =>
      expect(deps.emailSender.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: "owner@example.com" }),
      ),
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

describe("changePassword throttling", () => {
  it("keys the throttle by the stored email, sharing the count with login", async () => {
    const deps = makeDeps({}, { email: "foo@gmail.com" });

    await createChangePasswordService(deps).changePassword({
      ...input,
      currentPassword: "wrong-password-entirely",
    });

    expect(deps.throttle.registerFailure).toHaveBeenCalledWith("foo@gmail.com");
  });

  it("clears the throttle once the current password checks out", async () => {
    const deps = makeDeps();
    await createChangePasswordService(deps).changePassword(input);
    expect(deps.throttle.reset).toHaveBeenCalledWith("owner@example.com");
  });

  it("returns throttled without spending a password verification", async () => {
    const deps = makeDeps();
    deps.throttle.check.mockResolvedValue({
      outcome: "blocked",
      retryAfterSeconds: 42,
    });

    await expect(
      createChangePasswordService(deps).changePassword(input),
    ).resolves.toEqual({ outcome: "throttled", retryAfterSeconds: 42 });
    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(storedHash(deps)).toBe(currentHash);
  });
});
