import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../src/db/client.js";
import { createChangePassword } from "../../../src/features/change-password/use-case.js";
import { hashPassword } from "../../../src/lib/password.js";
import { DEFAULT_TTL } from "../../../src/lib/ttl.js";
import { createSessionsService } from "../../../src/modules/sessions/service.js";
import {
  createUsersService,
  type UsersService,
} from "../../../src/modules/users/service.js";
import type { EmailSender } from "../../../src/plugins/email/sender.js";
import { createInMemoryStore } from "../../helpers/in-memory-store.js";

// A spy over the real implementation: the existing tests still hash and verify
// for real, and a test can still assert the verification was never spent.
vi.mock("../../../src/lib/password.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/password.js")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});
const { verifyPassword } = await import("../../../src/lib/password.js");
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

// The store's repository factories ignore the executor they are handed, so
// any value satisfying the type stands in for a real connection.
const db = {} as Executor;

function setup(
  options: {
    email?: string;
    passwordHash?: string;
    emailSender?: EmailSender;
    checkPwnedPassword?: (password: string) => Promise<boolean>;
    withoutLog?: boolean;
    wrapUsersInTx?: (users: UsersService) => UsersService;
  } = {},
) {
  const store = createInMemoryStore({
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
      { userId: USER_ID, tokenHash: "laptop", deviceLabel: "Chrome on Linux" },
      { userId: USER_ID, tokenHash: "phone" },
      { userId: OTHER_USER_ID, tokenHash: "someone-else" },
    ],
  });
  const emailSender = options.emailSender ?? {
    send: vi.fn().mockResolvedValue({ providerMessageId: "x" }),
  };
  const checkPwnedPassword =
    options.checkPwnedPassword ?? vi.fn().mockResolvedValue(false);
  const throttle = {
    check: vi.fn().mockResolvedValue({ outcome: "allowed" }),
    registerFailure: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const buildUsers = (executor: Executor) =>
    createUsersService({
      repo: store.repositories.users(executor),
      emailSender,
      ...(options.withoutLog ? {} : { log }),
    });
  const buildSessions = (executor: Executor) =>
    createSessionsService({
      repo: store.repositories.sessions(executor),
      ttl: DEFAULT_TTL,
    });
  const changePassword = createChangePassword({
    transaction: store.transaction,
    users: {
      ...buildUsers(db),
      inTx: (tx) =>
        options.wrapUsersInTx
          ? options.wrapUsersInTx(buildUsers(tx))
          : buildUsers(tx),
    },
    sessions: { inTx: buildSessions },
    credentialThrottle: throttle,
    checkPwnedPassword,
    ...(options.withoutLog ? {} : { log }),
  });
  const storedHash = () => store.users.get(USER_ID)?.passwordHash ?? "";
  const sessionIdsOf = (userId: string) =>
    [...store.sessions.values()]
      .filter((session) => session.userId === userId)
      .map((session) => session.id);
  return {
    store,
    emailSender,
    checkPwnedPassword,
    throttle,
    log,
    changePassword,
    storedHash,
    sessionIdsOf,
  };
}

const input = {
  userId: USER_ID,
  currentSessionId: CURRENT_SESSION_ID,
  currentPassword: CURRENT,
  newPassword: NEXT,
};

describe("changePassword", () => {
  it("stores a new argon2 hash of the new password", async () => {
    const { changePassword, storedHash } = setup();

    await expect(changePassword(input)).resolves.toEqual({
      outcome: "changed",
    });
    expect(storedHash()).toMatch(/^\$argon2id\$/);
    expect(storedHash()).not.toContain(NEXT);
    expect(await verifyPassword(storedHash(), NEXT)).toBe(true);
  });

  it("deletes every other session of the account and keeps the current one", async () => {
    const { changePassword, sessionIdsOf } = setup();

    await changePassword(input);

    expect(sessionIdsOf(USER_ID)).toEqual([CURRENT_SESSION_ID]);
    expect(sessionIdsOf(OTHER_USER_ID)).toHaveLength(1);
  });

  it("leaves every session and the password in place when the password write fails", async () => {
    const { changePassword, storedHash, sessionIdsOf, emailSender } = setup({
      wrapUsersInTx: (users) => ({
        ...users,
        setPasswordHash: async () => {
          throw new Error("write failed");
        },
      }),
    });

    await expect(changePassword(input)).rejects.toThrow("write failed");
    expect(storedHash()).toBe(currentHash);
    expect(sessionIdsOf(USER_ID)).toHaveLength(3);
    expect(sessionIdsOf(USER_ID)).toContain(CURRENT_SESSION_ID);
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it("rejects an account that no longer exists as a wrong current password", async () => {
    const { changePassword, checkPwnedPassword, throttle } = setup();

    await expect(
      changePassword({
        ...input,
        userId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({ outcome: "invalid-current-password" });
    expect(checkPwnedPassword).not.toHaveBeenCalled();
    expect(throttle.check).not.toHaveBeenCalled();
  });

  it("rejects a wrong current password without writing anything", async () => {
    const { changePassword, storedHash, sessionIdsOf } = setup();

    await expect(
      changePassword({ ...input, currentPassword: "wrong-password-entirely" }),
    ).resolves.toEqual({ outcome: "invalid-current-password" });
    expect(storedHash()).toBe(currentHash);
    expect(sessionIdsOf(USER_ID)).toHaveLength(3);
  });

  it("checks the current password before the breach database", async () => {
    const { changePassword, checkPwnedPassword } = setup();

    await changePassword({
      ...input,
      currentPassword: "wrong-password-entirely",
    });

    expect(checkPwnedPassword).not.toHaveBeenCalled();
  });

  it("reports the wrong current password even when the new one equals it", async () => {
    const { changePassword } = setup({
      passwordHash: await hashPassword("something-else-entirely"),
    });

    await expect(
      changePassword({ ...input, newPassword: CURRENT }),
    ).resolves.toEqual({ outcome: "invalid-current-password" });
  });

  it("rejects a new password equal to the current one", async () => {
    const { changePassword, storedHash } = setup();

    await expect(
      changePassword({ ...input, newPassword: CURRENT }),
    ).resolves.toEqual({ outcome: "same-password" });
    expect(storedHash()).toBe(currentHash);
  });

  it("rejects a new password found in a breach", async () => {
    const { changePassword, storedHash, sessionIdsOf } = setup({
      checkPwnedPassword: vi.fn().mockResolvedValue(true),
    });

    await expect(changePassword(input)).resolves.toEqual({
      outcome: "pwned-password",
    });
    expect(storedHash()).toBe(currentHash);
    expect(sessionIdsOf(USER_ID)).toHaveLength(3);
  });

  it("asks the breach checker about the new password and proceeds on false", async () => {
    const { changePassword, checkPwnedPassword } = setup();

    await expect(changePassword(input)).resolves.toEqual({
      outcome: "changed",
    });
    expect(checkPwnedPassword).toHaveBeenCalledWith(NEXT);
  });

  it("sends the notification email to the account address", async () => {
    const { changePassword, emailSender } = setup();

    await changePassword(input);

    await vi.waitFor(() =>
      expect(emailSender.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: "owner@example.com" }),
      ),
    );
  });

  it("still succeeds when the notification email fails", async () => {
    const { changePassword } = setup({
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });

    await expect(changePassword(input)).resolves.toEqual({
      outcome: "changed",
    });
  });

  it("sends no notification when the current password is wrong", async () => {
    const { changePassword, emailSender } = setup();

    await changePassword({
      ...input,
      currentPassword: "wrong-password-entirely",
    });

    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it("sends no notification when the new password equals the current one", async () => {
    const { changePassword, emailSender } = setup();

    await changePassword({ ...input, newPassword: CURRENT });

    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it("sends no notification when the new password is found in a breach", async () => {
    const { changePassword, emailSender } = setup({
      checkPwnedPassword: vi.fn().mockResolvedValue(true),
    });

    await changePassword(input);

    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it("logs a failed attempt without the password", async () => {
    const { changePassword, log } = setup();

    await changePassword({ ...input, currentPassword: "wrong-password-here" });

    expect(log.warn).toHaveBeenCalledWith(
      { userId: USER_ID, reason: "invalid_current_password" },
      "password change failed",
    );
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(
      "wrong-password-here",
    );
  });

  it("logs the change with the user id and nothing else", async () => {
    const { changePassword, log } = setup();

    await changePassword(input);

    expect(log.info).toHaveBeenCalledWith(
      { userId: USER_ID },
      "password changed",
    );
  });

  it("works without a logger", async () => {
    const { changePassword } = setup({ withoutLog: true });

    await expect(changePassword(input)).resolves.toEqual({
      outcome: "changed",
    });
  });
});

describe("changePassword throttling", () => {
  it("keys the throttle by the stored email, sharing the count with login", async () => {
    const { changePassword, throttle } = setup({ email: "foo@gmail.com" });

    await changePassword({
      ...input,
      currentPassword: "wrong-password-entirely",
    });

    expect(throttle.registerFailure).toHaveBeenCalledWith("foo@gmail.com");
  });

  it("clears the throttle once the current password checks out", async () => {
    const { changePassword, throttle } = setup();

    await changePassword(input);

    expect(throttle.reset).toHaveBeenCalledWith("owner@example.com");
  });

  it("returns throttled without spending a password verification", async () => {
    const { changePassword, throttle, storedHash } = setup();
    throttle.check.mockResolvedValue({
      outcome: "blocked",
      retryAfterSeconds: 42,
    });

    await expect(changePassword(input)).resolves.toEqual({
      outcome: "throttled",
      retryAfterSeconds: 42,
    });
    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(storedHash()).toBe(currentHash);
  });
});
