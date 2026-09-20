import { describe, expect, it, vi } from "vitest";
import { verifyPassword } from "../../src/lib/password.js";
import { hashOtpCode } from "../../src/lib/token-hash.js";
import {
  createSignupService,
  SIGNUP_TTL_SECONDS,
} from "../../src/services/signup.js";

const NOW = new Date("2026-09-20T12:00:00Z");
const PASSWORD = "a perfectly fine passphrase";

function makeDeps() {
  return {
    repo: {
      findAuthUserByEmail: vi.fn().mockResolvedValue(undefined),
      findPendingSignupByEmail: vi.fn().mockResolvedValue(undefined),
      upsertPendingSignup: vi.fn().mockResolvedValue({ id: 1 }),
      resetPendingSignupSendState: vi.fn().mockResolvedValue(undefined),
    },
    emailSender: {
      send: vi.fn().mockResolvedValue({ providerMessageId: "msg-1" }),
    },
    checkPwnedPassword: vi.fn().mockResolvedValue(false),
    now: () => NOW,
  };
}

describe("signup service", () => {
  it("rejects pwned passwords without touching the database", async () => {
    const deps = makeDeps();
    deps.checkPwnedPassword.mockResolvedValue(true);
    const result = await createSignupService(deps).signup(
      "user@example.com",
      PASSWORD,
    );
    expect(result).toEqual({ outcome: "pwned-password" });
    expect(deps.repo.findAuthUserByEmail).not.toHaveBeenCalled();
    expect(deps.repo.upsertPendingSignup).not.toHaveBeenCalled();
    expect(deps.emailSender.send).not.toHaveBeenCalled();
  });

  it("normalizes the email before any lookup or write", async () => {
    const deps = makeDeps();
    await createSignupService(deps).signup("  Foo@Gmail.COM ", PASSWORD);
    expect(deps.repo.findAuthUserByEmail).toHaveBeenCalledWith("foo@gmail.com");
    expect(deps.repo.upsertPendingSignup).toHaveBeenCalledWith(
      expect.objectContaining({ email: "foo@gmail.com" }),
    );
  });

  it("returns generic success without creating anything when the account is already confirmed", async () => {
    const deps = makeDeps();
    deps.repo.findAuthUserByEmail.mockResolvedValue({ id: 1 });
    const result = await createSignupService(deps).signup(
      "user@example.com",
      PASSWORD,
    );
    expect(result.outcome).toBe("accepted");
    if (result.outcome === "accepted") {
      expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(deps.repo.upsertPendingSignup).not.toHaveBeenCalled();
    expect(deps.emailSender.send).not.toHaveBeenCalled();
  });

  it("is idempotent while a non-expired pending signup exists", async () => {
    const deps = makeDeps();
    deps.repo.findPendingSignupByEmail.mockResolvedValue({
      signupSessionToken: "stored-token",
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const result = await createSignupService(deps).signup(
      "user@example.com",
      PASSWORD,
    );
    expect(result).toEqual({
      outcome: "accepted",
      sessionToken: "stored-token",
    });
    expect(deps.repo.upsertPendingSignup).not.toHaveBeenCalled();
    expect(deps.emailSender.send).not.toHaveBeenCalled();
  });

  it("creates a pending signup with hashed password and code, then delivers the code", async () => {
    const deps = makeDeps();
    const result = await createSignupService(deps).signup(
      "foo@gmail.com",
      PASSWORD,
    );

    expect(deps.repo.upsertPendingSignup).toHaveBeenCalledOnce();
    const row = deps.repo.upsertPendingSignup.mock.calls[0]?.[0];
    expect(deps.emailSender.send).toHaveBeenCalledOnce();
    const message = deps.emailSender.send.mock.calls[0]?.[0];

    expect(message.to).toBe("foo@gmail.com");
    const code = message.subject.match(/\d{6}/)?.[0] ?? "";
    expect(code).toMatch(/^\d{6}$/);
    expect(row.codeHash).toBe(hashOtpCode(code));
    expect(message.html).toContain(code);
    expect(message.text).toContain(code);
    expect(row.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(row.passwordHash, PASSWORD)).toBe(true);
    expect(row.expiresAt).toEqual(
      new Date(NOW.getTime() + SIGNUP_TTL_SECONDS * 1000),
    );
    expect(row.now).toEqual(NOW);
    expect(result).toEqual({
      outcome: "accepted",
      sessionToken: row.signupSessionToken,
    });
  });

  it("replaces an expired pending signup", async () => {
    const deps = makeDeps();
    deps.repo.findPendingSignupByEmail.mockResolvedValue({
      signupSessionToken: "old-token",
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    const result = await createSignupService(deps).signup(
      "user@example.com",
      PASSWORD,
    );
    expect(deps.repo.upsertPendingSignup).toHaveBeenCalledOnce();
    expect(deps.emailSender.send).toHaveBeenCalledOnce();
    if (result.outcome === "accepted") {
      expect(result.sessionToken).not.toBe("old-token");
    }
  });

  it("persists before delivering the email", async () => {
    const deps = makeDeps();
    await createSignupService(deps).signup("user@example.com", PASSWORD);
    const upsertOrder =
      deps.repo.upsertPendingSignup.mock.invocationCallOrder[0];
    const emailOrder =
      deps.emailSender.send.mock.invocationCallOrder[0] ?? Number.NaN;
    expect(upsertOrder).toBeLessThan(emailOrder);
  });

  it("returns email-unavailable and resets send state when delivery fails", async () => {
    const deps = makeDeps();
    deps.emailSender.send.mockRejectedValueOnce(new Error("smtp down"));
    const result = await createSignupService(deps).signup(
      "foo@gmail.com",
      PASSWORD,
    );
    expect(result).toEqual({ outcome: "email-unavailable" });
    expect(deps.repo.resetPendingSignupSendState).toHaveBeenCalledWith(
      "foo@gmail.com",
    );
  });

  it("still returns email-unavailable when the reset itself fails", async () => {
    const deps = makeDeps();
    deps.emailSender.send.mockRejectedValueOnce(new Error("smtp down"));
    deps.repo.resetPendingSignupSendState.mockRejectedValueOnce(
      new Error("db down"),
    );
    await expect(
      createSignupService(deps).signup("foo@gmail.com", PASSWORD),
    ).resolves.toEqual({ outcome: "email-unavailable" });
  });
});
