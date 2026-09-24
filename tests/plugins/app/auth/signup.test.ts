import { describe, expect, it, vi } from "vitest";
import { verifyPassword } from "../../../../src/lib/password.js";
import { SIGNUP_TTL_SECONDS } from "../../../../src/lib/session.js";
import { hashOtpCode } from "../../../../src/lib/token-hash.js";
import { createSignupService } from "../../../../src/plugins/app/auth/signup.js";
import { FakeEmailSender } from "../../../../src/plugins/app/email/drivers/fake.js";
import { createInMemoryAuthRepository } from "../../../helpers/auth/in-memory-repository.js";

const NOW = new Date("2026-09-20T12:00:00Z");
const PASSWORD = "a perfectly fine passphrase";

function makeDeps() {
  return {
    repo: {
      findAuthUserByEmail: vi.fn().mockResolvedValue(undefined),
      findPendingSignupByEmail: vi.fn().mockResolvedValue(undefined),
      upsertPendingSignup: vi.fn().mockResolvedValue({ id: 1 }),
      markPendingSignupUndelivered: vi.fn().mockResolvedValue(undefined),
      rotatePendingSignupToken: vi.fn().mockResolvedValue(undefined),
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

  it("rotates the token and creates nothing while a non-expired pending signup exists", async () => {
    const deps = makeDeps();
    deps.repo.findPendingSignupByEmail.mockResolvedValue({
      signupSessionToken: "stored-token",
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const result = await createSignupService(deps).signup(
      "user@example.com",
      PASSWORD,
    );
    expect(result.outcome).toBe("accepted");
    if (result.outcome !== "accepted") return;
    expect(result.sessionToken).not.toBe("stored-token");
    expect(deps.repo.rotatePendingSignupToken).toHaveBeenCalledWith(
      "user@example.com",
      result.sessionToken,
    );
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

  it("still accepts the signup when delivery fails, and refunds the send", async () => {
    const deps = makeDeps();
    deps.emailSender.send.mockRejectedValueOnce(new Error("smtp down"));

    const result = await createSignupService(deps).signup(
      "foo@gmail.com",
      PASSWORD,
    );

    expect(result).toMatchObject({ outcome: "accepted" });
    await vi.waitFor(() =>
      expect(deps.repo.markPendingSignupUndelivered).toHaveBeenCalledWith(
        "foo@gmail.com",
      ),
    );
  });

  it("still accepts the signup when the mark itself fails", async () => {
    const deps = makeDeps();
    deps.emailSender.send.mockRejectedValueOnce(new Error("smtp down"));
    deps.repo.markPendingSignupUndelivered.mockRejectedValueOnce(
      new Error("db down"),
    );

    await expect(
      createSignupService(deps).signup("foo@gmail.com", PASSWORD),
    ).resolves.toMatchObject({ outcome: "accepted" });
    // Waiting for the continuation is what proves the rejected mark is caught:
    // an uncaught one fails the run instead of passing unnoticed.
    await vi.waitFor(() =>
      expect(deps.repo.markPendingSignupUndelivered).toHaveBeenCalled(),
    );
  });

  it("does not wait for the provider before returning", async () => {
    const deps = makeDeps();
    let release: () => void = () => {};
    deps.emailSender.send.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ providerMessageId: "late" });
        }),
    );

    await expect(
      createSignupService(deps).signup("new@example.com", PASSWORD),
    ).resolves.toMatchObject({ outcome: "accepted" });
    release();
  });

  it("hands out a different token on every call for a live pending signup", async () => {
    const repo = createInMemoryAuthRepository();
    const emailSender = new FakeEmailSender();
    const { signup } = createSignupService({
      repo,
      emailSender,
      checkPwnedPassword: vi.fn().mockResolvedValue(false),
    });

    const first = await signup("new@example.com", "a-valid-long-passphrase");
    const second = await signup("new@example.com", "a-valid-long-passphrase");

    expect(first.outcome).toBe("accepted");
    expect(second.outcome).toBe("accepted");
    if (first.outcome !== "accepted" || second.outcome !== "accepted") return;
    expect(second.sessionToken).not.toBe(first.sessionToken);
    // The second call is not a resend: no new code, no second email.
    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));
  });

  it("changes nothing but the token when it rotates", async () => {
    const repo = createInMemoryAuthRepository();
    const { signup } = createSignupService({
      repo,
      emailSender: new FakeEmailSender(),
      checkPwnedPassword: vi.fn().mockResolvedValue(false),
    });

    await signup("new@example.com", "a-valid-long-passphrase");
    await vi.waitFor(async () =>
      expect(
        (await repo.findPendingSignupByEmail("new@example.com"))?.codeSendCount,
      ).toBe(1),
    );
    const before = await repo.findPendingSignupByEmail("new@example.com");

    const second = await signup("new@example.com", "a-valid-long-passphrase");
    const after = await repo.findPendingSignupByEmail("new@example.com");

    expect(after?.codeHash).toBe(before?.codeHash);
    expect(after?.codeAttempts).toBe(before?.codeAttempts);
    expect(after?.codeSendCount).toBe(before?.codeSendCount);
    expect(after?.expiresAt).toEqual(before?.expiresAt);
    expect(after?.lastSentAt).toEqual(before?.lastSentAt);
    if (second.outcome !== "accepted") return;
    expect(after?.signupSessionToken).toBe(second.sessionToken);
  });

  it("keeps a confirmed account indistinguishable, with a new token every call", async () => {
    const repo = createInMemoryAuthRepository({
      authUsers: [{ id: 1, email: "taken@example.com" }],
    });
    const { signup } = createSignupService({
      repo,
      emailSender: new FakeEmailSender(),
      checkPwnedPassword: vi.fn().mockResolvedValue(false),
    });

    const first = await signup("taken@example.com", "a-valid-long-passphrase");
    const second = await signup("taken@example.com", "a-valid-long-passphrase");

    if (first.outcome !== "accepted" || second.outcome !== "accepted") return;
    expect(second.sessionToken).not.toBe(first.sessionToken);
  });
});
