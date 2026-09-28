import { describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../src/db/client.js";
import { createVerifySignup } from "../../../src/features/verify-signup/use-case.js";
import {
  hashOtpCode,
  hashSessionToken,
  hashVerificationToken,
} from "../../../src/lib/token-hash.js";
import { DEFAULT_TTL } from "../../../src/lib/ttl.js";
import {
  createOtpService,
  type OtpService,
} from "../../../src/modules/otp/service.js";
import { createSessionsService } from "../../../src/modules/sessions/service.js";
import { createUsersService } from "../../../src/modules/users/service.js";
import { FakeEmailSender } from "../../../src/plugins/email/drivers/fake.js";
import { TEST_HMAC_SECRET } from "../../helpers/app-options.js";
import {
  createInMemoryStore,
  type InMemoryStore,
} from "../../helpers/in-memory-store.js";

const SESSION_TTL_SECONDS = 60 * 60;
const NOW = new Date("2026-09-24T12:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "user@example.com";
const TOKEN = "signup-token";
const CODE = "123456";
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The store's repository factories ignore the executor they are handed, so
// any value satisfying the type stands in for a real connection.
const db = {} as Executor;

function setup(
  options: {
    emailVerifiedAt?: Date | null;
    issuedAt?: Date;
    codeAttempts?: number;
    wrapVerify?: (
      verify: OtpService["verify"],
      store: InMemoryStore,
    ) => OtpService["verify"];
  } = {},
) {
  const store = createInMemoryStore({
    users: [
      {
        id: USER_ID,
        email: EMAIL,
        emailVerifiedAt:
          options.emailVerifiedAt === undefined
            ? null
            : options.emailVerifiedAt,
      },
    ],
    verificationCodes: [
      {
        userId: USER_ID,
        purpose: "signup",
        tokenHash: hashVerificationToken(TOKEN),
        codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
        codeAttempts: options.codeAttempts ?? 0,
        issuedAt: options.issuedAt ?? NOW,
      },
    ],
  });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const emailSender = new FakeEmailSender();
  const buildOtp = (executor: Executor) =>
    createOtpService({
      repo: store.repositories.otp(executor),
      emailSender,
      ttl: DEFAULT_TTL,
      hmacSecret: TEST_HMAC_SECRET,
      log,
      now: () => NOW,
    });
  const buildUsers = (executor: Executor) =>
    createUsersService({
      repo: store.repositories.users(executor),
      emailSender,
      log,
    });
  const buildSessions = (executor: Executor) =>
    createSessionsService({
      repo: store.repositories.sessions(executor),
      ttl: { ...DEFAULT_TTL, sessionSeconds: SESSION_TTL_SECONDS },
      now: () => NOW,
    });
  const otp = buildOtp(db);
  const verifySignup = createVerifySignup({
    transaction: store.transaction,
    otp: {
      verify: options.wrapVerify
        ? options.wrapVerify(otp.verify, store)
        : otp.verify,
      inTx: buildOtp,
    },
    users: { inTx: buildUsers },
    sessions: { inTx: buildSessions },
    log,
    now: () => NOW,
  });
  const code = () => store.verificationCodes.get(`${USER_ID}:signup`);
  return { store, log, verifySignup, code };
}

describe("verifySignup", () => {
  it("confirms the address, consumes the code and opens a session", async () => {
    const { store, code, verifySignup } = setup();

    const result = await verifySignup(TOKEN, CODE, "Firefox on macOS");

    expect(result).toEqual({
      outcome: "verified",
      sessionToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    if (result.outcome !== "verified") return;
    expect(store.users.get(USER_ID)?.emailVerifiedAt).toEqual(NOW);
    expect(code()).toBeUndefined();
    expect([...store.sessions.values()]).toEqual([
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

  it("logs the confirmation with the user id and nothing else", async () => {
    const { log, verifySignup } = setup();

    await verifySignup(TOKEN, CODE, null);

    expect(log.info).toHaveBeenCalledWith(
      { userId: USER_ID },
      "email verified",
    );
  });

  it("rejects a missing cookie", async () => {
    const { store, code, verifySignup } = setup();

    expect(await verifySignup(undefined, CODE, null)).toEqual({
      outcome: "invalid",
    });
    expect(code()).toBeDefined();
    expect(store.sessions.size).toBe(0);
  });

  it("rejects a token that matches no code", async () => {
    const { store, verifySignup } = setup();

    expect(await verifySignup("not-a-real-token", CODE, null)).toEqual({
      outcome: "invalid",
    });
    expect(store.users.get(USER_ID)?.emailVerifiedAt).toBeNull();
    expect(store.sessions.size).toBe(0);
  });

  it("rejects a wrong code, counts the attempt and confirms nothing", async () => {
    const { store, code, verifySignup } = setup();

    expect(await verifySignup(TOKEN, "000000", null)).toEqual({
      outcome: "invalid",
    });
    expect(code()?.codeAttempts).toBe(1);
    expect(store.users.get(USER_ID)?.emailVerifiedAt).toBeNull();
    expect(store.sessions.size).toBe(0);
  });

  it("rejects an expired code", async () => {
    const { store, verifySignup } = setup({
      issuedAt: new Date(NOW.getTime() - DEFAULT_TTL.signupCodeSeconds * 1000),
    });

    expect(await verifySignup(TOKEN, CODE, null)).toEqual({
      outcome: "invalid",
    });
    expect(store.sessions.size).toBe(0);
  });

  it("rejects the right code once the attempts are exhausted", async () => {
    const { store, verifySignup } = setup({ codeAttempts: 5 });

    expect(await verifySignup(TOKEN, CODE, null)).toEqual({
      outcome: "invalid",
    });
    expect(store.users.get(USER_ID)?.emailVerifiedAt).toBeNull();
  });

  it("loses when the token is rotated between the check and the confirmation", async () => {
    const { store, log, verifySignup } = setup({
      wrapVerify: (verify, store) => async (purpose, token, code) => {
        const result = await verify(purpose, token, code);
        // A signup for the same address lands in between.
        await store.repositories
          .otp(db)
          .rotateToken(
            { userId: USER_ID, purpose: "signup" },
            hashVerificationToken("a-newer-token"),
          );
        return result;
      },
    });

    expect(await verifySignup(TOKEN, CODE, null)).toEqual({
      outcome: "invalid",
    });
    expect(store.users.get(USER_ID)?.emailVerifiedAt).toBeNull();
    expect(store.sessions.size).toBe(0);
    expect(log.info).toHaveBeenCalledWith(
      { userId: USER_ID },
      "signup code already consumed by a concurrent request",
    );
  });

  it("lets only one of two concurrent confirmations with the same code win", async () => {
    const { store, verifySignup } = setup();

    const results = await Promise.all([
      verifySignup(TOKEN, CODE, null),
      verifySignup(TOKEN, CODE, null),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "invalid",
      "verified",
    ]);
    expect(store.sessions.size).toBe(1);
  });

  it("never opens a session from a leftover code of an already confirmed account", async () => {
    const { store, verifySignup } = setup({ emailVerifiedAt: new Date(0) });

    expect(await verifySignup(TOKEN, CODE, null)).toEqual({
      outcome: "invalid",
    });
    expect(store.users.get(USER_ID)?.emailVerifiedAt).toEqual(new Date(0));
    expect(store.sessions.size).toBe(0);
  });

  it("rolls the consumed code back when the account turns out to be confirmed already", async () => {
    const { store, log, code, verifySignup } = setup({
      emailVerifiedAt: new Date(0),
    });
    const before = structuredClone(code());

    expect(await verifySignup(TOKEN, CODE, null)).toEqual({
      outcome: "invalid",
    });
    expect(code()).toEqual(before);
    expect(store.verificationCodes.size).toBe(1);
    expect(store.sessions.size).toBe(0);
    expect(log.info).toHaveBeenCalledWith(
      { userId: USER_ID },
      "signup code already consumed by a concurrent request",
    );
    expect(log.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "email verified",
    );
  });
});
