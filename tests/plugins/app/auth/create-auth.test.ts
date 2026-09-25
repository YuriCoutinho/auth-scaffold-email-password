import { describe, expect, it, vi } from "vitest";
import { hashSessionToken } from "../../../../src/lib/token-hash.js";
import { DEFAULT_TTL, type TtlPolicy } from "../../../../src/lib/ttl.js";
import { createAuth } from "../../../../src/plugins/app/auth/create-auth.js";
import { createCredentialThrottle } from "../../../../src/plugins/app/credential-throttle/create-credential-throttle.js";
import { FakeEmailSender } from "../../../../src/plugins/email/drivers/fake.js";
import { TEST_HMAC_SECRET } from "../../../helpers/app-options.js";
import {
  createInMemoryStore,
  type InMemorySeed,
} from "../../../helpers/in-memory-store.js";

const NOW = new Date("2026-09-24T12:00:00Z");

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
    credentialThrottle: createCredentialThrottle({
      hmacSecret: TEST_HMAC_SECRET,
      repository: store.legacy,
    }),
    ttl,
    now: () => NOW,
  });
  return { store, repository, emailSender, auth };
}

describe("createAuth", () => {
  it("exposes every auth flow over one repository", async () => {
    const { store, auth } = setup();

    const signup = await auth.signup(
      "user@example.com",
      "a perfectly fine passphrase",
    );
    expect(signup.outcome).toBe("accepted");
    expect(store.users.size).toBe(1);
    expect(store.verificationCodes.size).toBe(1);

    expect((await auth.resendCode(undefined)).outcome).toBe("invalid-session");
    expect((await auth.verifyCode(undefined, "000000", null)).outcome).toBe(
      "invalid",
    );
    expect((await auth.login("nobody@example.com", "x", null)).outcome).toBe(
      "invalid",
    );
    expect(
      (await auth.forgotPassword("nobody@example.com")).sessionToken,
    ).toBeTruthy();
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

  it("carries a signup through to a confirmed account with a session", async () => {
    const { store, emailSender, auth } = setup();

    const signup = await auth.signup(
      "user@example.com",
      "a perfectly fine passphrase",
    );
    if (signup.outcome !== "accepted") throw new Error("expected accepted");
    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));
    const code = emailSender.sent[0]?.subject.match(/\d{6}/)?.[0] ?? "";

    const verified = await auth.verifyCode(signup.sessionToken, code, null);
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
    const { store, emailSender, auth } = setup(
      {},
      { ...DEFAULT_TTL, sessionSeconds: 60 },
    );

    const signup = await auth.signup(
      "user@example.com",
      "a perfectly fine passphrase",
    );
    if (signup.outcome !== "accepted") throw new Error("expected accepted");
    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));
    const code = emailSender.sent[0]?.subject.match(/\d{6}/)?.[0] ?? "";
    await auth.verifyCode(signup.sessionToken, code, null);

    expect([...store.sessions.values()]).toEqual([
      expect.objectContaining({ expiresAt: new Date(NOW.getTime() + 60_000) }),
    ]);
  });

  it("passes the code ttl to the emails", async () => {
    const { emailSender, auth } = setup(
      {},
      {
        ...DEFAULT_TTL,
        signupCodeSeconds: 10 * 60,
      },
    );

    await auth.signup("user@example.com", "a perfectly fine passphrase");

    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));
    expect(emailSender.sent[0]?.text).toContain("10 minutes");
  });
});
