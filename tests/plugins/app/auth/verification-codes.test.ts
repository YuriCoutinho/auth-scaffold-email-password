import { describe, expect, it, vi } from "vitest";
import { MAX_CODE_ATTEMPTS } from "../../../../src/lib/session.js";
import {
  hashOtpCode,
  hashVerificationToken,
} from "../../../../src/lib/token-hash.js";
import { DEFAULT_TTL } from "../../../../src/lib/ttl.js";
import type { VerificationPurpose } from "../../../../src/plugins/app/auth/repository.js";
import { createVerificationCodes } from "../../../../src/plugins/app/auth/verification-codes.js";
import { TEST_HMAC_SECRET } from "../../../helpers/app-options.js";
import {
  createInMemoryStore,
  type InMemorySeed,
} from "../../../helpers/in-memory-store.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "owner@example.com";
const CODE = "123456";
const TOKEN = "a-verification-token";

function secondsAgo(seconds: number) {
  return new Date(NOW.getTime() - seconds * 1000);
}

function setup(options: { seed?: InMemorySeed } = {}) {
  const store = createInMemoryStore(
    options.seed ?? { users: [{ id: USER_ID, email: EMAIL }] },
  );
  const repo = store.legacy;
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const codes = createVerificationCodes({
    hmacSecret: TEST_HMAC_SECRET,
    repo,
    log,
    now: () => NOW,
  });
  const stored = (purpose: VerificationPurpose) =>
    store.verificationCodes.get(`${USER_ID}:${purpose}`);
  return { store, repo, log, codes, stored };
}

// A user with a code already on file, reached through the token TOKEN.
function seedWithCode(
  purpose: VerificationPurpose,
  code: Partial<{
    codeAttempts: number;
    codeSendCount: number;
    issuedAt: Date;
    expiresAt: Date;
    codeHash: string;
  }> = {},
  emailVerifiedAt: Date | null = new Date(0),
): InMemorySeed {
  return {
    users: [{ id: USER_ID, email: EMAIL, emailVerifiedAt }],
    verificationCodes: [
      {
        userId: USER_ID,
        purpose,
        tokenHash: hashVerificationToken(TOKEN),
        codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
        codeAttempts: 0,
        codeSendCount: 1,
        issuedAt: NOW,
        ...code,
      },
    ],
  };
}

describe("verification codes: verify", () => {
  it("rejects a missing token without a lookup", async () => {
    const { codes, repo } = setup({ seed: seedWithCode("signup") });
    const lookup = vi.spyOn(repo, "findVerificationCodeByTokenHash");

    expect(await codes.verify("signup", undefined, CODE)).toEqual({
      outcome: "invalid",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects an unknown token and logs it without the token", async () => {
    const { codes, log } = setup({ seed: seedWithCode("signup") });

    expect(await codes.verify("signup", "unknown-token", CODE)).toEqual({
      outcome: "invalid",
    });
    expect(log.info).toHaveBeenCalledWith(
      { purpose: "signup" },
      "signup code token not recognized",
    );
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("unknown-token");
  });

  it("rejects a token of another purpose", async () => {
    const { codes } = setup({ seed: seedWithCode("signup") });

    expect(await codes.verify("password_reset", TOKEN, CODE)).toEqual({
      outcome: "invalid",
    });
  });

  it("rejects an expired code, even the right one, without counting an attempt", async () => {
    const { codes, stored, log } = setup({
      seed: seedWithCode("signup", {
        issuedAt: secondsAgo(DEFAULT_TTL.signupCodeSeconds),
      }),
    });

    expect(await codes.verify("signup", TOKEN, CODE)).toEqual({
      outcome: "invalid",
    });
    expect(stored("signup")?.codeAttempts).toBe(0);
    expect(log.info).toHaveBeenCalledWith(
      { userId: USER_ID, purpose: "signup" },
      "signup code expired",
    );
  });

  it("rejects a code exactly at its stored expiry", async () => {
    const { codes } = setup({
      seed: seedWithCode("signup", {
        issuedAt: secondsAgo(60),
        expiresAt: NOW,
      }),
    });

    expect(await codes.verify("signup", TOKEN, CODE)).toEqual({
      outcome: "invalid",
    });
  });

  it("keeps an exhausted code unusable even when the right code arrives", async () => {
    const { codes, stored } = setup({
      seed: seedWithCode("signup", { codeAttempts: MAX_CODE_ATTEMPTS }),
    });

    expect(await codes.verify("signup", TOKEN, CODE)).toEqual({
      outcome: "invalid",
    });
    expect(stored("signup")?.codeAttempts).toBe(MAX_CODE_ATTEMPTS);
  });

  it("counts a wrong code as an attempt and warns without the code", async () => {
    const { codes, stored, log } = setup({ seed: seedWithCode("signup") });

    expect(await codes.verify("signup", TOKEN, "000000")).toEqual({
      outcome: "invalid",
    });
    expect(stored("signup")?.codeAttempts).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(
      { userId: USER_ID, purpose: "signup", codeAttempts: 1 },
      "signup code verification failed",
    );
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("000000");
  });

  it("warns that the code is invalidated on the last allowed attempt", async () => {
    const { codes, stored, log } = setup({
      seed: seedWithCode("password_reset", {
        codeAttempts: MAX_CODE_ATTEMPTS - 1,
      }),
    });

    await codes.verify("password_reset", TOKEN, "000000");

    expect(stored("password_reset")?.codeAttempts).toBe(MAX_CODE_ATTEMPTS);
    expect(log.warn).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        purpose: "password_reset",
        codeAttempts: MAX_CODE_ATTEMPTS,
      },
      "password reset code invalidated after too many failed attempts",
    );
  });

  it("returns the record for the right code without consuming it", async () => {
    const { codes, stored } = setup({
      seed: seedWithCode("signup", { codeAttempts: 2 }),
    });

    expect(await codes.verify("signup", TOKEN, CODE)).toEqual({
      outcome: "valid",
      code: {
        userId: USER_ID,
        purpose: "signup",
        tokenHash: hashVerificationToken(TOKEN),
        codeHash: hashOtpCode(TEST_HMAC_SECRET, CODE),
        codeAttempts: 2,
        codeSendCount: 1,
        issuedAt: NOW,
        expiresAt: new Date(
          NOW.getTime() + DEFAULT_TTL.signupCodeSeconds * 1000,
        ),
        email: EMAIL,
        passwordHash: "seeded-hash",
      },
    });
    expect(stored("signup")?.codeAttempts).toBe(2);
  });
});
