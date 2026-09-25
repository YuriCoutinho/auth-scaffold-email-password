import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../src/db/client.js";
import { createSignup } from "../../../src/features/signup/use-case.js";
import {
  hashOtpCode,
  hashVerificationToken,
} from "../../../src/lib/token-hash.js";
import { DEFAULT_TTL, type TtlPolicy } from "../../../src/lib/ttl.js";
import { createOtpService } from "../../../src/modules/otp/service.js";
import { createUsersService } from "../../../src/modules/users/service.js";
import { FakeEmailSender } from "../../../src/plugins/email/drivers/fake.js";
import type { EmailSender } from "../../../src/plugins/email/sender.js";
import type { TransactionRunner } from "../../../src/plugins/transaction.js";
import { TEST_HMAC_SECRET } from "../../helpers/app-options.js";
import {
  createInMemoryStore,
  type InMemorySeed,
} from "../../helpers/in-memory-store.js";

// A spy over the real implementation: every test still hashes for real, and
// the timing cases can assert argon2 ran on each branch.
vi.mock("../../../src/lib/password.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/password.js")>();
  return { ...actual, hashPassword: vi.fn(actual.hashPassword) };
});
const { hashPassword, verifyPassword } = await import(
  "../../../src/lib/password.js"
);
const hashPasswordMock = vi.mocked(hashPassword);

const NOW = new Date("2026-09-24T12:00:00Z");
const EMAIL = "user@example.com";
const PASSWORD = "a perfectly fine passphrase";
const OTHER_PASSWORD = "another perfectly fine passphrase";
const USER_ID = "11111111-1111-4111-8111-111111111111";

// The store's repository factories ignore the executor they are handed, so
// any value satisfying the type stands in for a real connection.
const db = {} as Executor;

beforeEach(() => {
  hashPasswordMock.mockClear();
});

function setup(
  seed: InMemorySeed = {},
  options: {
    emailSender?: EmailSender;
    ttl?: TtlPolicy;
    transaction?: (
      store: ReturnType<typeof createInMemoryStore>,
    ) => TransactionRunner;
  } = {},
) {
  const store = createInMemoryStore(seed);
  const fake = new FakeEmailSender();
  const emailSender = options.emailSender ?? fake;
  const send = vi.spyOn(emailSender, "send");
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const checkPwnedPassword = vi.fn().mockResolvedValue(false);
  const buildUsers = (executor: Executor) =>
    createUsersService({
      repo: store.repositories.users(executor),
      emailSender,
      log,
    });
  const buildOtp = (executor: Executor) =>
    createOtpService({
      repo: store.repositories.otp(executor),
      emailSender,
      ttl: options.ttl ?? DEFAULT_TTL,
      hmacSecret: TEST_HMAC_SECRET,
      log,
      now: () => NOW,
    });
  const users = { ...buildUsers(db), inTx: buildUsers };
  const otp = { ...buildOtp(db), inTx: buildOtp };
  const signup = createSignup({
    transaction: options.transaction?.(store) ?? store.transaction,
    users,
    otp,
    checkPwnedPassword,
    log,
  });
  return {
    store,
    users,
    otp,
    fake,
    send,
    log,
    checkPwnedPassword,
    signup,
  };
}

async function acceptedToken(
  result: Awaited<ReturnType<ReturnType<typeof setup>["signup"]>>,
) {
  expect(result.outcome).toBe("accepted");
  return result.outcome === "accepted" ? result.sessionToken : "";
}

const userByEmail = (store: ReturnType<typeof setup>["store"], email: string) =>
  [...store.users.values()].find((user) => user.email === email);

describe("signup", () => {
  it("rejects a pwned password without writing or hashing anything", async () => {
    const { store, send, checkPwnedPassword, signup } = setup();
    checkPwnedPassword.mockResolvedValue(true);

    expect(await signup(EMAIL, PASSWORD)).toEqual({
      outcome: "pwned-password",
    });
    expect(hashPasswordMock).not.toHaveBeenCalled();
    expect(store.users.size).toBe(0);
    expect(store.verificationCodes.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("creates an unconfirmed account with the hashed password and emails its code", async () => {
    const { store, fake, signup } = setup();

    const token = await acceptedToken(await signup(EMAIL, PASSWORD));

    const user = userByEmail(store, EMAIL);
    expect(user?.emailVerifiedAt).toBeNull();
    expect(user?.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(user?.passwordHash ?? "", PASSWORD)).toBe(true);

    const code = [...store.verificationCodes.values()].find(
      (candidate) => candidate.tokenHash === hashVerificationToken(token),
    );
    expect(code).toMatchObject({
      userId: user?.id,
      purpose: "signup",
      codeSendCount: 1,
    });
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    expect(fake.sent[0]?.to).toBe(EMAIL);
    const sentCode = fake.sent[0]?.subject.match(/\d{6}/)?.[0] ?? "";
    expect(code?.codeHash).toBe(hashOtpCode(TEST_HMAC_SECRET, sentCode));
  });

  it("normalizes the email before any lookup or write", async () => {
    const { store, signup } = setup();

    await signup("  User@Example.COM ", PASSWORD);

    expect(userByEmail(store, EMAIL)).toBeDefined();
    expect(store.users.size).toBe(1);
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

  it("returns a throwaway token and writes or sends nothing for a confirmed address", async () => {
    const { store, send, signup } = setup({
      users: [{ id: USER_ID, email: EMAIL, passwordHash: "owner-hash" }],
    });

    const first = await acceptedToken(await signup(EMAIL, PASSWORD));
    const second = await acceptedToken(await signup(EMAIL, PASSWORD));

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(store.users.get(USER_ID)).toMatchObject({
      passwordHash: "owner-hash",
      emailVerifiedAt: new Date(0),
    });
    expect(store.verificationCodes.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("lets the latest signup win: the password is replaced and the old token no longer confirms", async () => {
    const { store, otp, fake, signup } = setup();

    const attackerToken = await acceptedToken(await signup(EMAIL, PASSWORD));
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    const code = fake.sent[0]?.subject.match(/\d{6}/)?.[0] ?? "";
    const ownerToken = await acceptedToken(await signup(EMAIL, OTHER_PASSWORD));

    const user = userByEmail(store, EMAIL);
    expect(await verifyPassword(user?.passwordHash ?? "", OTHER_PASSWORD)).toBe(
      true,
    );
    expect(await verifyPassword(user?.passwordHash ?? "", PASSWORD)).toBe(
      false,
    );
    expect(store.users.size).toBe(1);

    expect(await otp.verify("signup", attackerToken, code)).toEqual({
      outcome: "invalid",
    });
    expect(userByEmail(store, EMAIL)?.emailVerifiedAt).toBeNull();
    expect(await otp.verify("signup", ownerToken, code)).toMatchObject({
      outcome: "valid",
      code: { userId: user?.id },
    });
  });

  it("does not send a second code for a signup repeated inside the cooldown", async () => {
    const { fake, send, signup } = setup();

    await signup(EMAIL, PASSWORD);
    await signup(EMAIL, OTHER_PASSWORD);

    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    expect(send).toHaveBeenCalledOnce();
  });

  it("answers like a confirmed address when the account is confirmed between the read and the write", async () => {
    const store = createInMemoryStore({
      users: [{ id: USER_ID, email: EMAIL, passwordHash: "owner-hash" }],
    });
    const emailSender = new FakeEmailSender();
    const send = vi.spyOn(emailSender, "send");
    const buildUsers = (executor: Executor) =>
      createUsersService({
        repo: store.repositories.users(executor),
        emailSender,
      });
    const buildOtp = (executor: Executor) =>
      createOtpService({
        repo: store.repositories.otp(executor),
        emailSender,
        ttl: DEFAULT_TTL,
        hmacSecret: TEST_HMAC_SECRET,
        now: () => NOW,
      });
    const signup = createSignup({
      transaction: store.transaction,
      // The read misses the confirmation that a concurrent verify just landed.
      users: {
        findByEmail: vi.fn().mockResolvedValue(undefined),
        inTx: buildUsers,
      },
      otp: { ...buildOtp(db), inTx: buildOtp },
      checkPwnedPassword: vi.fn().mockResolvedValue(false),
    });

    const token = await acceptedToken(await signup(EMAIL, PASSWORD));

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.users.get(USER_ID)?.passwordHash).toBe("owner-hash");
    expect(store.users.size).toBe(1);
    expect(store.verificationCodes.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("delivers the code only after the transaction resolved", async () => {
    const events: string[] = [];
    const { send, signup } = setup(
      {},
      {
        transaction: (store) => async (work) => {
          const result = await store.transaction(work);
          events.push("transaction resolved");
          return result;
        },
      },
    );
    send.mockImplementation(async () => {
      events.push("send");
      return { providerMessageId: "fake-1" };
    });

    await signup(EMAIL, PASSWORD);

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(events).toEqual(["transaction resolved", "send"]);
  });

  it("still accepts the signup when delivery fails", async () => {
    const { store, signup } = setup(
      {},
      { emailSender: { send: vi.fn().mockRejectedValue(new Error("down")) } },
    );

    expect((await signup(EMAIL, PASSWORD)).outcome).toBe("accepted");
    await vi.waitFor(() =>
      expect([...store.verificationCodes.values()][0]?.codeSendCount).toBe(0),
    );
  });

  it("states the configured signup ttl in the email", async () => {
    const { fake, signup } = setup(
      {},
      { ttl: { ...DEFAULT_TTL, signupCodeSeconds: 10 * 60 } },
    );

    await signup(EMAIL, PASSWORD);

    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    expect(fake.sent[0]?.text).toContain("10 minutes");
  });

  it("logs the signup start with the user id and never the email", async () => {
    const { store, log, signup } = setup();

    await signup(EMAIL, PASSWORD);

    const userId = userByEmail(store, EMAIL)?.id;
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
