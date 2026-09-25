import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hashOtpCode,
  hashVerificationToken,
} from "../../../../src/lib/token-hash.js";
import { DEFAULT_TTL } from "../../../../src/lib/ttl.js";
import { createSignupService } from "../../../../src/plugins/app/auth/signup.js";
import { createVerificationCodes } from "../../../../src/plugins/app/auth/verification-codes.js";
import { createVerifyCodeService } from "../../../../src/plugins/app/auth/verify-code.js";
import { FakeEmailSender } from "../../../../src/plugins/app/email/drivers/fake.js";
import { TEST_HMAC_SECRET } from "../../../helpers/app-options.js";
import {
  createInMemoryAuthRepository,
  type InMemorySeed,
} from "../../../helpers/auth/in-memory-repository.js";

// A spy over the real implementation: every test still hashes for real, and
// the timing cases can assert argon2 ran on each branch.
vi.mock("../../../../src/lib/password.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/lib/password.js")>();
  return { ...actual, hashPassword: vi.fn(actual.hashPassword) };
});
const { hashPassword, verifyPassword } = await import(
  "../../../../src/lib/password.js"
);
const hashPasswordMock = vi.mocked(hashPassword);

const NOW = new Date("2026-09-24T12:00:00Z");
const EMAIL = "user@example.com";
const PASSWORD = "a perfectly fine passphrase";
const OTHER_PASSWORD = "another perfectly fine passphrase";
const USER_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  hashPasswordMock.mockClear();
});

function setup(seed: InMemorySeed = {}) {
  const repo = createInMemoryAuthRepository(seed);
  const emailSender = new FakeEmailSender();
  const send = vi.spyOn(emailSender, "send");
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const checkPwnedPassword = vi.fn().mockResolvedValue(false);
  const codes = createVerificationCodes({
    hmacSecret: TEST_HMAC_SECRET,
    repo,
    emailSender,
    ttl: DEFAULT_TTL,
    log,
    now: () => NOW,
  });
  const { signup } = createSignupService({
    repo,
    codes,
    checkPwnedPassword,
    log,
    now: () => NOW,
  });
  const { verifyCode } = createVerifyCodeService({
    repo,
    codes,
    now: () => NOW,
  });
  return {
    repo,
    emailSender,
    send,
    log,
    checkPwnedPassword,
    signup,
    verifyCode,
  };
}

async function acceptedToken(
  result: Awaited<ReturnType<ReturnType<typeof setup>["signup"]>>,
) {
  expect(result.outcome).toBe("accepted");
  return result.outcome === "accepted" ? result.sessionToken : "";
}

const userByEmail = (repo: ReturnType<typeof setup>["repo"], email: string) =>
  [...repo.users.values()].find((user) => user.email === email);

describe("signup service", () => {
  it("rejects a pwned password without writing or hashing anything", async () => {
    const { repo, send, checkPwnedPassword, signup } = setup();
    checkPwnedPassword.mockResolvedValue(true);

    expect(await signup(EMAIL, PASSWORD)).toEqual({
      outcome: "pwned-password",
    });
    expect(repo.users.size).toBe(0);
    expect(repo.verificationCodes.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("creates an unconfirmed account with the hashed password and emails its code", async () => {
    const { repo, emailSender, signup } = setup();

    const token = await acceptedToken(await signup(EMAIL, PASSWORD));

    const user = userByEmail(repo, EMAIL);
    expect(user?.emailVerifiedAt).toBeNull();
    expect(user?.createdAt).toEqual(NOW);
    expect(user?.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(user?.passwordHash ?? "", PASSWORD)).toBe(true);

    const code = await repo.findVerificationCodeByTokenHash(
      "signup",
      hashVerificationToken(token),
    );
    expect(code).toMatchObject({ userId: user?.id, codeSendCount: 1 });
    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));
    expect(emailSender.sent[0]?.to).toBe(EMAIL);
    const sentCode = emailSender.sent[0]?.subject.match(/\d{6}/)?.[0] ?? "";
    expect(code?.codeHash).toBe(hashOtpCode(TEST_HMAC_SECRET, sentCode));
  });

  it("normalizes the email before any lookup or write", async () => {
    const { repo, signup } = setup();

    await signup("  User@Example.COM ", PASSWORD);

    expect(userByEmail(repo, EMAIL)).toBeDefined();
    expect(repo.users.size).toBe(1);
  });

  it.each([
    { name: "a new address", seed: {} },
    {
      name: "a pending address",
      seed: { users: [{ id: USER_ID, email: EMAIL, emailVerifiedAt: null }] },
    },
    {
      name: "a confirmed address",
      seed: { users: [{ id: USER_ID, email: EMAIL }] },
    },
  ])("runs argon2 exactly once for $name", async ({ seed }) => {
    const { signup } = setup(seed);

    await signup(EMAIL, PASSWORD);

    expect(hashPasswordMock).toHaveBeenCalledOnce();
    expect(hashPasswordMock).toHaveBeenCalledWith(PASSWORD);
  });

  it("returns a throwaway token and writes nothing for a confirmed address", async () => {
    const { repo, send, signup } = setup({
      users: [{ id: USER_ID, email: EMAIL, passwordHash: "owner-hash" }],
    });

    const first = await acceptedToken(await signup(EMAIL, PASSWORD));
    const second = await acceptedToken(await signup(EMAIL, PASSWORD));

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(repo.users.get(USER_ID)).toMatchObject({
      passwordHash: "owner-hash",
      emailVerifiedAt: new Date(0),
    });
    expect(repo.verificationCodes.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("lets the latest signup win: the password is replaced and the old token no longer confirms", async () => {
    const { repo, emailSender, signup, verifyCode } = setup();

    const attackerToken = await acceptedToken(await signup(EMAIL, PASSWORD));
    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));
    const code = emailSender.sent[0]?.subject.match(/\d{6}/)?.[0] ?? "";
    const ownerToken = await acceptedToken(await signup(EMAIL, OTHER_PASSWORD));

    const user = userByEmail(repo, EMAIL);
    expect(await verifyPassword(user?.passwordHash ?? "", OTHER_PASSWORD)).toBe(
      true,
    );
    expect(await verifyPassword(user?.passwordHash ?? "", PASSWORD)).toBe(
      false,
    );
    expect(repo.users.size).toBe(1);

    expect(await verifyCode(attackerToken, code, null)).toEqual({
      outcome: "invalid",
    });
    expect(userByEmail(repo, EMAIL)?.emailVerifiedAt).toBeNull();
    expect(await verifyCode(ownerToken, code, null)).toMatchObject({
      outcome: "verified",
    });
  });

  it("does not send a second code for a signup repeated inside the cooldown", async () => {
    const { emailSender, send, signup } = setup();

    await signup(EMAIL, PASSWORD);
    await signup(EMAIL, OTHER_PASSWORD);

    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));
    expect(send).toHaveBeenCalledOnce();
  });

  it("answers like a confirmed address when the account is confirmed between the read and the write", async () => {
    const { repo, send, signup } = setup({
      users: [{ id: USER_ID, email: EMAIL, passwordHash: "owner-hash" }],
    });
    // The read misses the confirmation that a concurrent verify just landed.
    repo.findUserByEmail = vi.fn().mockResolvedValue(undefined);

    const token = await acceptedToken(await signup(EMAIL, PASSWORD));

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repo.users.get(USER_ID)?.passwordHash).toBe("owner-hash");
    expect(repo.users.size).toBe(1);
    expect(repo.verificationCodes.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("still accepts the signup when delivery fails", async () => {
    const repo = createInMemoryAuthRepository();
    const codes = createVerificationCodes({
      hmacSecret: TEST_HMAC_SECRET,
      repo,
      emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) },
      ttl: DEFAULT_TTL,
      now: () => NOW,
    });
    const { signup } = createSignupService({
      repo,
      codes,
      checkPwnedPassword: vi.fn().mockResolvedValue(false),
      now: () => NOW,
    });

    expect((await signup(EMAIL, PASSWORD)).outcome).toBe("accepted");
    await vi.waitFor(() =>
      expect([...repo.verificationCodes.values()][0]?.codeSendCount).toBe(0),
    );
  });

  it("logs the signup start with the user id and never the email", async () => {
    const { repo, log, signup } = setup();

    await signup(EMAIL, PASSWORD);

    const userId = userByEmail(repo, EMAIL)?.id;
    expect(log.info).toHaveBeenCalledWith({ userId }, "signup started");
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(EMAIL);
  });

  it("logs no signup start for a confirmed address", async () => {
    const { log, signup } = setup({
      users: [{ id: USER_ID, email: EMAIL }],
    });

    await signup(EMAIL, PASSWORD);

    expect(log.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "signup started",
    );
  });
});
