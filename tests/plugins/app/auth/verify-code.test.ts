import { describe, expect, it, vi } from "vitest";
import {
  hashOtpCode,
  hashSessionToken,
  hashVerificationToken,
} from "../../../../src/lib/token-hash.js";
import { DEFAULT_TTL } from "../../../../src/lib/ttl.js";
import type { VerificationCodes } from "../../../../src/plugins/app/auth/verification-codes.js";
import { createVerificationCodes } from "../../../../src/plugins/app/auth/verification-codes.js";
import { createVerifyCodeService } from "../../../../src/plugins/app/auth/verify-code.js";
import { FakeEmailSender } from "../../../../src/plugins/app/email/drivers/fake.js";
import { createInMemoryAuthRepository } from "../../../helpers/auth/in-memory-repository.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "user@example.com";
const TOKEN = "signup-token";
const CODE = "123456";
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function setup(
  options: {
    emailVerifiedAt?: Date | null;
    issuedAt?: Date;
    codeAttempts?: number;
    wrapCodes?: (codes: VerificationCodes) => Pick<VerificationCodes, "verify">;
  } = {},
) {
  const repo = createInMemoryAuthRepository({
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
        codeHash: hashOtpCode(CODE),
        codeAttempts: options.codeAttempts ?? 0,
        issuedAt: options.issuedAt ?? NOW,
      },
    ],
  });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const codes = createVerificationCodes({
    repo,
    emailSender: new FakeEmailSender(),
    ttl: DEFAULT_TTL,
    log,
    now: () => NOW,
  });
  const { verifyCode } = createVerifyCodeService({
    repo,
    codes: options.wrapCodes ? options.wrapCodes(codes) : codes,
    log,
    now: () => NOW,
  });
  const code = () => repo.verificationCodes.get(`${USER_ID}:signup`);
  return { repo, log, codes, verifyCode, code };
}

describe("verifyCode", () => {
  it("confirms the address, consumes the code and opens a session", async () => {
    const { repo, code, verifyCode } = setup();

    const result = await verifyCode(TOKEN, CODE, "Firefox on macOS");

    expect(result).toEqual({
      outcome: "verified",
      sessionToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    if (result.outcome !== "verified") return;
    expect(repo.users.get(USER_ID)?.emailVerifiedAt).toEqual(NOW);
    expect(code()).toBeUndefined();
    expect([...repo.sessions.values()]).toEqual([
      {
        id: expect.stringMatching(UUID_V4),
        userId: USER_ID,
        tokenHash: hashSessionToken(result.sessionToken),
        deviceLabel: "Firefox on macOS",
        createdAt: NOW,
      },
    ]);
  });

  it("logs the confirmation with the user id and nothing else", async () => {
    const { log, verifyCode } = setup();

    await verifyCode(TOKEN, CODE, null);

    expect(log.info).toHaveBeenCalledWith(
      { userId: USER_ID },
      "email verified",
    );
  });

  it("rejects a missing cookie", async () => {
    const { repo, code, verifyCode } = setup();

    expect(await verifyCode(undefined, CODE, null)).toEqual({
      outcome: "invalid",
    });
    expect(code()).toBeDefined();
    expect(repo.sessions.size).toBe(0);
  });

  it("rejects a token that matches no code", async () => {
    const { repo, verifyCode } = setup();

    expect(await verifyCode("not-a-real-token", CODE, null)).toEqual({
      outcome: "invalid",
    });
    expect(repo.users.get(USER_ID)?.emailVerifiedAt).toBeNull();
    expect(repo.sessions.size).toBe(0);
  });

  it("rejects a wrong code, counts the attempt and confirms nothing", async () => {
    const { repo, code, verifyCode } = setup();

    expect(await verifyCode(TOKEN, "000000", null)).toEqual({
      outcome: "invalid",
    });
    expect(code()?.codeAttempts).toBe(1);
    expect(repo.users.get(USER_ID)?.emailVerifiedAt).toBeNull();
    expect(repo.sessions.size).toBe(0);
  });

  it("rejects an expired code", async () => {
    const { repo, verifyCode } = setup({
      issuedAt: new Date(NOW.getTime() - DEFAULT_TTL.signupCodeSeconds * 1000),
    });

    expect(await verifyCode(TOKEN, CODE, null)).toEqual({ outcome: "invalid" });
    expect(repo.sessions.size).toBe(0);
  });

  it("rejects the right code once the attempts are exhausted", async () => {
    const { repo, verifyCode } = setup({ codeAttempts: 5 });

    expect(await verifyCode(TOKEN, CODE, null)).toEqual({ outcome: "invalid" });
    expect(repo.users.get(USER_ID)?.emailVerifiedAt).toBeNull();
  });

  it("loses when the token is rotated between the check and the confirmation", async () => {
    const { repo, log, verifyCode } = setup({
      wrapCodes: (codes) => ({
        async verify(...args) {
          const result = await codes.verify(...args);
          // A signup for the same address lands in between.
          await repo.rotateVerificationToken(
            { userId: USER_ID, purpose: "signup" },
            hashVerificationToken("a-newer-token"),
          );
          return result;
        },
      }),
    });

    expect(await verifyCode(TOKEN, CODE, null)).toEqual({ outcome: "invalid" });
    expect(repo.users.get(USER_ID)?.emailVerifiedAt).toBeNull();
    expect(repo.sessions.size).toBe(0);
    expect(log.info).toHaveBeenCalledWith(
      { userId: USER_ID },
      "signup code already consumed by a concurrent request",
    );
  });

  it("lets only one of two concurrent confirmations with the same code win", async () => {
    const { repo, verifyCode } = setup();

    const results = await Promise.all([
      verifyCode(TOKEN, CODE, null),
      verifyCode(TOKEN, CODE, null),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "invalid",
      "verified",
    ]);
    expect(repo.sessions.size).toBe(1);
  });

  it("never opens a session from a leftover code of an already confirmed account", async () => {
    const { repo, verifyCode } = setup({ emailVerifiedAt: new Date(0) });

    expect(await verifyCode(TOKEN, CODE, null)).toEqual({ outcome: "invalid" });
    expect(repo.users.get(USER_ID)?.emailVerifiedAt).toEqual(new Date(0));
    expect(repo.sessions.size).toBe(0);
  });
});
