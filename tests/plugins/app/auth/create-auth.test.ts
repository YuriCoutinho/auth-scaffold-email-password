import { describe, expect, it, vi } from "vitest";
import { createAuth } from "../../../../src/plugins/app/auth/create-auth.js";
import { createInMemoryAuthRepository } from "../../../helpers/auth/in-memory-repository.js";

describe("createAuth", () => {
  it("exposes every auth flow over one repository", async () => {
    const repository = createInMemoryAuthRepository();
    const auth = createAuth({
      repository,
      sessionRepository: repository,
      emailSender: {
        send: vi.fn().mockResolvedValue({ providerMessageId: "msg-1" }),
      },
      checkPwnedPassword: vi.fn().mockResolvedValue(false),
    });

    const signup = await auth.signup(
      "user@example.com",
      "a perfectly fine passphrase",
    );
    expect(signup.outcome).toBe("accepted");
    expect(repository.pendingSignups.size).toBe(1);

    expect((await auth.resendCode(undefined)).outcome).toBe("invalid-session");
    expect((await auth.verifyCode(undefined, "000000", null)).outcome).toBe(
      "invalid",
    );
    expect((await auth.login("nobody@example.com", "x", null)).outcome).toBe(
      "invalid",
    );
    expect((await auth.authenticate(undefined)).outcome).toBe("invalid");
    expect(
      await auth.logoutAll({
        userId: 999,
        currentSessionId: 1,
        includeCurrentSession: false,
      }),
    ).toEqual({ revokedCount: 0, currentSessionRevoked: false });
    expect(
      await auth.listSessions({ userId: 999, currentSessionId: 1 }),
    ).toEqual([]);
    expect(await auth.currentUser(999)).toBeUndefined();
  });

  it("resolves the current user through the repository", async () => {
    const repository = createInMemoryAuthRepository({
      authUsers: [{ id: 7, email: "a@b.com" }],
    });
    const auth = createAuth({
      repository,
      sessionRepository: repository,
      emailSender: { send: vi.fn() },
      checkPwnedPassword: vi.fn().mockResolvedValue(false),
    });

    expect(await auth.currentUser(7)).toMatchObject({ email: "a@b.com" });
  });

  it("exposes logout and resolves it for an unknown token", async () => {
    const repository = createInMemoryAuthRepository();
    const auth = createAuth({
      repository,
      sessionRepository: repository,
      emailSender: { send: vi.fn() },
      checkPwnedPassword: vi.fn().mockResolvedValue(false),
    });

    await expect(auth.logout("unknown-token")).resolves.toBeUndefined();
  });
});
