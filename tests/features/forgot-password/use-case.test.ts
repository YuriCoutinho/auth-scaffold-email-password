import { describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../src/db/client.js";
import { createForgotPassword } from "../../../src/features/forgot-password/use-case.js";
import { hashVerificationToken } from "../../../src/lib/token-hash.js";
import { DEFAULT_TTL } from "../../../src/lib/ttl.js";
import { createOtpService } from "../../../src/modules/otp/service.js";
import { createUsersService } from "../../../src/modules/users/service.js";
import { FakeEmailSender } from "../../../src/plugins/email/drivers/fake.js";
import type { EmailSender } from "../../../src/plugins/email/sender.js";
import { TEST_HMAC_SECRET } from "../../helpers/app-options.js";
import { createInMemoryStore } from "../../helpers/in-memory-store.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "reset@example.com";

// The store's repository factories ignore the executor they are handed, so
// any value satisfying the type stands in for a real connection.
const db = {} as Executor;

function setup(
  options: { emailVerifiedAt?: Date | null; emailSender?: EmailSender } = {},
) {
  const store = createInMemoryStore({
    users: [
      {
        id: USER_ID,
        email: EMAIL,
        passwordHash: "old",
        ...(options.emailVerifiedAt === undefined
          ? {}
          : { emailVerifiedAt: options.emailVerifiedAt }),
      },
    ],
  });
  const fake = new FakeEmailSender();
  const emailSender = options.emailSender ?? fake;
  // Spied so the "nothing was sent" cases can assert synchronously, instead of
  // reading a list that a detached send may not have filled yet.
  const send = vi.spyOn(emailSender, "send");
  const users = createUsersService({
    repo: store.repositories.users(db),
    emailSender,
  });
  const otp = createOtpService({
    repo: store.repositories.otp(db),
    emailSender,
    ttl: DEFAULT_TTL,
    hmacSecret: TEST_HMAC_SECRET,
    now: () => NOW,
  });
  const forgotPassword = createForgotPassword({ users, otp });
  const findByToken = (token: string) =>
    store.repositories
      .otp(db)
      .findByTokenHash("password_reset", hashVerificationToken(token));
  return { store, fake, send, forgotPassword, findByToken };
}

describe("forgotPassword", () => {
  it("issues a reset code and emails it for a confirmed account", async () => {
    const { fake, forgotPassword, findByToken } = setup();

    const { sessionToken } = await forgotPassword(EMAIL);

    expect(await findByToken(sessionToken)).toMatchObject({
      userId: USER_ID,
      purpose: "password_reset",
      codeAttempts: 0,
      codeSendCount: 1,
    });
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    expect(fake.sent[0]?.to).toBe(EMAIL);
    expect(fake.sent[0]?.subject).toContain("password reset code");
  });

  it("normalizes the address before looking the account up", async () => {
    const { forgotPassword, findByToken } = setup();

    const { sessionToken } = await forgotPassword("  RESET@Example.com  ");

    expect(await findByToken(sessionToken)).toBeDefined();
  });

  it("hands back a throwaway token and writes nothing for an unknown address", async () => {
    const { store, send, forgotPassword, findByToken } = setup();

    const { sessionToken } = await forgotPassword("nobody@example.com");

    expect(sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await findByToken(sessionToken)).toBeUndefined();
    expect(store.verificationCodes.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("hands back a throwaway token and writes nothing for an unconfirmed account", async () => {
    const { store, send, forgotPassword, findByToken } = setup({
      emailVerifiedAt: null,
    });

    const { sessionToken } = await forgotPassword(EMAIL);

    expect(sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await findByToken(sessionToken)).toBeUndefined();
    expect(store.verificationCodes.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("hands out a different token on every call and keeps one row", async () => {
    const { store, forgotPassword, findByToken } = setup();

    const first = await forgotPassword(EMAIL);
    const second = await forgotPassword(EMAIL);

    expect(second.sessionToken).not.toBe(first.sessionToken);
    expect(store.verificationCodes.size).toBe(1);
    expect(await findByToken(first.sessionToken)).toBeUndefined();
    expect(await findByToken(second.sessionToken)).toMatchObject({
      userId: USER_ID,
    });
  });

  it("does not wait for the provider before returning", async () => {
    const { send, forgotPassword } = setup({
      emailSender: { send: () => new Promise(() => {}) },
    });

    await expect(forgotPassword(EMAIL)).resolves.toMatchObject({
      sessionToken: expect.any(String),
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("answers the same way when delivery fails", async () => {
    const { forgotPassword, findByToken } = setup({
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
    });

    const { sessionToken } = await forgotPassword(EMAIL);

    await vi.waitFor(async () =>
      expect((await findByToken(sessionToken))?.codeSendCount).toBe(0),
    );
  });
});
