import { describe, expect, it, vi } from "vitest";
import { SESSION_TTL_SECONDS } from "../../src/lib/session.js";
import { hashOtpCode, hashSessionToken } from "../../src/lib/token-hash.js";
import {
  createVerifyCodeService,
  MAX_CODE_ATTEMPTS,
} from "../../src/services/verify-code.js";

const NOW = new Date("2026-09-21T12:00:00Z");
const TOKEN = "signup-token";
const CODE = "123456";

function makePending(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: "foo@gmail.com",
    passwordHash: "argon2-hash",
    codeHash: hashOtpCode(CODE),
    codeAttempts: 0,
    lastSentAt: new Date("2026-09-21T11:59:00Z"),
    codeSendCount: 1,
    expiresAt: new Date("2026-09-21T12:10:00Z"),
    ...overrides,
  };
}

function makeDeps(pending: ReturnType<typeof makePending> | undefined) {
  return {
    repo: {
      findPendingSignupBySessionToken: vi.fn().mockResolvedValue(pending),
      incrementCodeAttempts: vi.fn().mockResolvedValue(undefined),
      promotePendingSignup: vi
        .fn()
        .mockResolvedValue({ id: 7, publicId: "pub-7" }),
    },
    now: () => NOW,
  };
}

describe("verifyCode", () => {
  it("returns invalid when the cookie token is missing", async () => {
    const deps = makeDeps(undefined);
    await expect(
      createVerifyCodeService(deps).verifyCode(undefined, CODE, null),
    ).resolves.toEqual({ outcome: "invalid" });
    expect(deps.repo.findPendingSignupBySessionToken).not.toHaveBeenCalled();
  });

  it("returns invalid when no pending signup matches", async () => {
    const deps = makeDeps(undefined);
    await expect(
      createVerifyCodeService(deps).verifyCode(TOKEN, CODE, null),
    ).resolves.toEqual({ outcome: "invalid" });
  });

  it("returns invalid when the pending signup is expired", async () => {
    const deps = makeDeps(
      makePending({ expiresAt: new Date("2026-09-21T11:59:59Z") }),
    );
    await expect(
      createVerifyCodeService(deps).verifyCode(TOKEN, CODE, null),
    ).resolves.toEqual({ outcome: "invalid" });
    expect(deps.repo.promotePendingSignup).not.toHaveBeenCalled();
  });

  it("returns invalid without comparing or incrementing when attempts are exhausted", async () => {
    const deps = makeDeps(makePending({ codeAttempts: MAX_CODE_ATTEMPTS }));
    await expect(
      createVerifyCodeService(deps).verifyCode(TOKEN, CODE, null),
    ).resolves.toEqual({ outcome: "invalid" });
    expect(deps.repo.incrementCodeAttempts).not.toHaveBeenCalled();
    expect(deps.repo.promotePendingSignup).not.toHaveBeenCalled();
  });

  it("increments attempts and returns invalid on a wrong code", async () => {
    const deps = makeDeps(makePending());
    await expect(
      createVerifyCodeService(deps).verifyCode(TOKEN, "654321", null),
    ).resolves.toEqual({ outcome: "invalid" });
    expect(deps.repo.incrementCodeAttempts).toHaveBeenCalledWith(TOKEN);
    expect(deps.repo.promotePendingSignup).not.toHaveBeenCalled();
  });

  it("promotes atomically and returns a fresh session token on the right code", async () => {
    const deps = makeDeps(makePending());
    const result = await createVerifyCodeService(deps).verifyCode(
      TOKEN,
      CODE,
      "Mozilla/5.0",
    );

    expect(result.outcome).toBe("verified");
    const sessionToken =
      result.outcome === "verified" ? result.sessionToken : "";
    expect(sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url

    const input = deps.repo.promotePendingSignup.mock.calls[0]?.[0];
    expect(input).toEqual({
      email: "foo@gmail.com",
      passwordHash: "argon2-hash",
      signupSessionToken: TOKEN,
      sessionTokenHash: hashSessionToken(sessionToken),
      deviceLabel: "Mozilla/5.0",
      sessionExpiresAt: new Date(NOW.getTime() + SESSION_TTL_SECONDS * 1000),
    });
    expect(input.sessionTokenHash).not.toBe(sessionToken);
    expect(deps.repo.incrementCodeAttempts).not.toHaveBeenCalled();
  });
});
