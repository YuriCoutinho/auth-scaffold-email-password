import { describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../../src/db/client.js";
import {
  hashOtpCode,
  hashSessionToken,
  hashVerificationToken,
} from "../../../../src/lib/token-hash.js";
import { DEFAULT_TTL, type TtlPolicy } from "../../../../src/lib/ttl.js";
import { createCredentialThrottleService } from "../../../../src/modules/credential-throttle/service.js";
import { createAuth } from "../../../../src/plugins/app/auth/create-auth.js";
import { FakeEmailSender } from "../../../../src/plugins/email/drivers/fake.js";
import { TEST_HMAC_SECRET } from "../../../helpers/app-options.js";
import {
  createInMemoryStore,
  type InMemorySeed,
} from "../../../helpers/in-memory-store.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SIGNUP_TOKEN = "a-signup-token";
const SIGNUP_CODE = "123456";
const PENDING_SIGNUP: InMemorySeed = {
  users: [{ id: USER_ID, email: "user@example.com", emailVerifiedAt: null }],
  verificationCodes: [
    {
      userId: USER_ID,
      purpose: "signup",
      tokenHash: hashVerificationToken(SIGNUP_TOKEN),
      codeHash: hashOtpCode(TEST_HMAC_SECRET, SIGNUP_CODE),
      issuedAt: NOW,
    },
  ],
};

// The store's credential-throttle repository factory ignores the executor it
// is handed, so any value satisfying the type stands in for a real connection.
const db = {} as Executor;

function setup(seed: InMemorySeed = {}, ttl: TtlPolicy = DEFAULT_TTL) {
  const store = createInMemoryStore(seed);
  const repository = store.legacy;
  const emailSender = new FakeEmailSender();
  const auth = createAuth({
    hmacSecret: TEST_HMAC_SECRET,
    repository,
    sessionRepository: repository,
    emailSender,
    checkPwnedPassword: vi.fn().mockResolvedValue(false),
    credentialThrottle: createCredentialThrottleService({
      hmacSecret: TEST_HMAC_SECRET,
      repo: store.repositories.credentialThrottle(db),
    }),
    ttl,
    now: () => NOW,
  });
  return { store, repository, emailSender, auth };
}

describe("createAuth", () => {
  it("exposes every auth flow over one repository", async () => {
    const { auth } = setup();

    expect((await auth.verifyCode(undefined, "000000", null)).outcome).toBe(
      "invalid",
    );
    expect((await auth.login("nobody@example.com", "x", null)).outcome).toBe(
      "invalid",
    );
    expect(
      (
        await auth.resetPassword({
          sessionToken: undefined,
          code: "000000",
          newPassword: "a perfectly fine passphrase",
          deviceLabel: null,
        })
      ).outcome,
    ).toBe("invalid");
  });

  it("carries a pending signup through to a confirmed account with a session", async () => {
    const { store, auth } = setup(PENDING_SIGNUP);

    const verified = await auth.verifyCode(SIGNUP_TOKEN, SIGNUP_CODE, null);
    if (verified.outcome !== "verified") throw new Error("expected verified");

    const tokenHash = hashSessionToken(verified.sessionToken);
    expect(
      [...store.sessions.values()].some(
        (session) => session.tokenHash === tokenHash,
      ),
    ).toBe(true);
    expect(store.verificationCodes.size).toBe(0);
  });

  it("stamps the sessions it opens with the configured session ttl", async () => {
    const { store, auth } = setup(PENDING_SIGNUP, {
      ...DEFAULT_TTL,
      sessionSeconds: 60,
    });

    await auth.verifyCode(SIGNUP_TOKEN, SIGNUP_CODE, null);

    expect([...store.sessions.values()]).toEqual([
      expect.objectContaining({ expiresAt: new Date(NOW.getTime() + 60_000) }),
    ]);
  });
});
