import { beforeEach, describe, expect, it, vi } from "vitest";
import { DUMMY_PASSWORD_HASH } from "../../../../src/lib/password.js";
import { hashSessionToken } from "../../../../src/lib/token-hash.js";
import { createLoginService } from "../../../../src/plugins/app/auth/login.js";
import { createInMemoryAuthRepository } from "../../../helpers/auth/in-memory-repository.js";

vi.mock("../../../../src/lib/password.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/lib/password.js")>();
  return { ...actual, verifyPassword: vi.fn() };
});
const { verifyPassword } = await import("../../../../src/lib/password.js");
const verifyPasswordMock = vi.mocked(verifyPassword);

const SESSION_TTL_SECONDS = 60 * 60;
const NOW = new Date("2026-09-24T12:00:00Z");
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "foo@gmail.com";
const PASSWORD_HASH = "argon2-real-hash";

function setup(emailVerifiedAt: Date | null | "no-account" = new Date(0)) {
  const repo = createInMemoryAuthRepository({
    users:
      emailVerifiedAt === "no-account"
        ? []
        : [
            {
              id: USER_ID,
              email: EMAIL,
              passwordHash: PASSWORD_HASH,
              emailVerifiedAt,
            },
          ],
  });
  const throttle = {
    check: vi.fn().mockResolvedValue({ outcome: "allowed" }),
    registerFailure: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const { login } = createLoginService({
    repo,
    sessionTtlSeconds: SESSION_TTL_SECONDS,
    throttle,
    log,
    now: () => NOW,
  });
  return { repo, throttle, log, login };
}

beforeEach(() => {
  verifyPasswordMock.mockReset();
});

describe("login", () => {
  it("opens a session and hands back its token on the right password", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    const { repo, login } = setup();

    const result = await login(EMAIL, "secret", "Firefox on macOS");

    expect(result).toEqual({
      outcome: "authenticated",
      sessionToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    if (result.outcome !== "authenticated") return;
    expect([...repo.sessions.values()]).toEqual([
      {
        id: expect.stringMatching(UUID_V4),
        userId: USER_ID,
        tokenHash: hashSessionToken(result.sessionToken),
        deviceLabel: "Firefox on macOS",
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + SESSION_TTL_SECONDS * 1000),
      },
    ]);
  });

  it("normalizes the email before lookup", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    const { login } = setup();

    expect((await login("  Foo@GMAIL.com ", "secret", null)).outcome).toBe(
      "authenticated",
    );
  });

  it("rejects a wrong password without opening a session", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    const { repo, login } = setup();

    expect(await login(EMAIL, "wrong", null)).toEqual({ outcome: "invalid" });
    expect(verifyPasswordMock).toHaveBeenCalledWith(PASSWORD_HASH, "wrong");
    expect(repo.sessions.size).toBe(0);
  });

  it("verifies against the dummy hash when the address has no account", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    const { repo, login } = setup("no-account");

    expect(await login(EMAIL, "secret", null)).toEqual({ outcome: "invalid" });
    expect(verifyPasswordMock).toHaveBeenCalledOnce();
    expect(verifyPasswordMock).toHaveBeenCalledWith(
      DUMMY_PASSWORD_HASH,
      "secret",
    );
    expect(repo.sessions.size).toBe(0);
  });

  it("does not authenticate a ghost user even if the dummy verification passes", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    const { repo, login } = setup("no-account");

    expect(await login(EMAIL, "secret", null)).toEqual({ outcome: "invalid" });
    expect(repo.sessions.size).toBe(0);
  });

  it("answers an unconfirmed account like an unknown address, with one dummy verification", async () => {
    // Even the right password must not sign in an unconfirmed account.
    verifyPasswordMock.mockResolvedValue(true);
    const { repo, log, throttle, login } = setup(null);

    expect(await login(EMAIL, "secret", null)).toEqual({ outcome: "invalid" });
    expect(verifyPasswordMock).toHaveBeenCalledOnce();
    expect(verifyPasswordMock).toHaveBeenCalledWith(
      DUMMY_PASSWORD_HASH,
      "secret",
    );
    expect(repo.sessions.size).toBe(0);
    expect(throttle.registerFailure).toHaveBeenCalledWith(EMAIL);
    expect(log.warn).toHaveBeenCalledWith(
      { userId: undefined, reason: "user_not_found" },
      "login failed",
    );
  });

  it("logs failed attempts without password or email", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    const { log, login } = setup();

    await login(EMAIL, "wrong", null);

    expect(log.warn).toHaveBeenCalledWith(
      { userId: USER_ID, reason: "invalid_password" },
      "login failed",
    );
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(EMAIL);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("wrong");
  });
});

describe("login throttling", () => {
  it("returns throttled without spending a password verification", async () => {
    const { repo, throttle, login } = setup();
    throttle.check.mockResolvedValue({
      outcome: "blocked",
      retryAfterSeconds: 42,
    });

    expect(await login(EMAIL, "secret", null)).toEqual({
      outcome: "throttled",
      retryAfterSeconds: 42,
    });
    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(repo.sessions.size).toBe(0);
  });

  it("registers a failure under the normalized email", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    const { throttle, login } = setup();

    await login("  Foo@GMAIL.com ", "secret", null);

    expect(throttle.registerFailure).toHaveBeenCalledWith(EMAIL);
  });

  it("registers a failure for an email that belongs to no account", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    const { throttle, login } = setup("no-account");

    await login("nobody@gmail.com", "secret", null);

    expect(throttle.registerFailure).toHaveBeenCalledWith("nobody@gmail.com");
  });

  it("clears the throttle on a successful login", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    const { throttle, login } = setup();

    await login(EMAIL, "secret", null);

    expect(throttle.reset).toHaveBeenCalledWith(EMAIL);
    expect(throttle.registerFailure).not.toHaveBeenCalled();
  });
});
