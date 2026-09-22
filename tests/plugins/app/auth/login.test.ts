import { beforeEach, describe, expect, it, vi } from "vitest";
import { DUMMY_PASSWORD_HASH } from "../../../../src/lib/password.js";
import { SESSION_TTL_SECONDS } from "../../../../src/lib/session.js";
import { hashSessionToken } from "../../../../src/lib/token-hash.js";
import { createLoginService } from "../../../../src/plugins/app/auth/login.js";

vi.mock("../../../../src/lib/password.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/lib/password.js")>();
  return { ...actual, verifyPassword: vi.fn() };
});
const { verifyPassword } = await import("../../../../src/lib/password.js");
const verifyPasswordMock = vi.mocked(verifyPassword);

const NOW = new Date("2026-09-21T12:00:00Z");
const USER = {
  id: 7,
  publicId: "11111111-1111-1111-1111-111111111111",
  passwordHash: "argon2-real-hash",
};

function makeDeps(user: typeof USER | undefined) {
  return {
    repo: {
      findAuthUserByEmail: vi.fn().mockResolvedValue(user),
      createSession: vi.fn().mockResolvedValue(undefined),
    },
    now: () => NOW,
  };
}

beforeEach(() => {
  verifyPasswordMock.mockReset();
});

describe("login", () => {
  it("normalizes the email before lookup", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    const deps = makeDeps(USER);
    await createLoginService(deps).login("  Foo@GMAIL.com ", "secret", null);
    expect(deps.repo.findAuthUserByEmail).toHaveBeenCalledWith("foo@gmail.com");
  });

  it("verifies against the dummy hash when the user does not exist (no quick exit)", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    const deps = makeDeps(undefined);
    await expect(
      createLoginService(deps).login("foo@gmail.com", "secret", null),
    ).resolves.toEqual({ outcome: "invalid" });
    expect(verifyPasswordMock).toHaveBeenCalledWith(
      DUMMY_PASSWORD_HASH,
      "secret",
    );
    expect(deps.repo.createSession).not.toHaveBeenCalled();
  });

  it("returns invalid on wrong password without creating a session", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    const deps = makeDeps(USER);
    await expect(
      createLoginService(deps).login("foo@gmail.com", "wrong", null),
    ).resolves.toEqual({ outcome: "invalid" });
    expect(verifyPasswordMock).toHaveBeenCalledWith(USER.passwordHash, "wrong");
    expect(deps.repo.createSession).not.toHaveBeenCalled();
  });

  it("does not authenticate a ghost user even if the dummy verification passes", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    const deps = makeDeps(undefined);
    await expect(
      createLoginService(deps).login("foo@gmail.com", "secret", null),
    ).resolves.toEqual({ outcome: "invalid" });
    expect(deps.repo.createSession).not.toHaveBeenCalled();
  });

  it("creates a session and returns only public user data on success", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    const deps = makeDeps(USER);
    const result = await createLoginService(deps).login(
      "foo@gmail.com",
      "secret",
      "Mozilla/5.0",
    );

    expect(result.outcome).toBe("authenticated");
    const sessionToken =
      result.outcome === "authenticated" ? result.sessionToken : "";
    expect(sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
    expect(result).toEqual({
      outcome: "authenticated",
      sessionToken,
      user: { publicId: USER.publicId },
    });
    expect(deps.repo.createSession).toHaveBeenCalledWith({
      userId: USER.id,
      tokenHash: hashSessionToken(sessionToken),
      deviceLabel: "Mozilla/5.0",
      expiresAt: new Date(NOW.getTime() + SESSION_TTL_SECONDS * 1000),
    });
  });

  it("logs failed attempts without password or email", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    const deps = {
      ...makeDeps(USER),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    await createLoginService(deps).login("foo@gmail.com", "wrong", null);
    expect(deps.log.warn).toHaveBeenCalledWith(
      { userId: USER.id, reason: "invalid_password" },
      "login failed",
    );
  });
});
