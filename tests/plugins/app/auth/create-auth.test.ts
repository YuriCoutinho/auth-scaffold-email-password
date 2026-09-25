import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TTL, type TtlPolicy } from "../../../../src/lib/ttl.js";
import { createAuth } from "../../../../src/plugins/app/auth/create-auth.js";
import { createCredentialThrottle } from "../../../../src/plugins/app/credential-throttle/create-credential-throttle.js";
import { FakeEmailSender } from "../../../../src/plugins/app/email/drivers/fake.js";
import { TEST_HMAC_SECRET } from "../../../helpers/app-options.js";
import {
  createInMemoryAuthRepository,
  type InMemorySeed,
} from "../../../helpers/auth/in-memory-repository.js";
import { createInMemoryCredentialThrottleRepository } from "../../../helpers/credential-throttle/in-memory-repository.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";

function setup(seed: InMemorySeed = {}, ttl: TtlPolicy = DEFAULT_TTL) {
  const repository = createInMemoryAuthRepository(seed);
  const emailSender = new FakeEmailSender();
  const auth = createAuth({
    hmacSecret: TEST_HMAC_SECRET,
    repository,
    sessionRepository: repository,
    emailSender,
    checkPwnedPassword: vi.fn().mockResolvedValue(false),
    credentialThrottle: createCredentialThrottle({
      hmacSecret: TEST_HMAC_SECRET,
      repository: createInMemoryCredentialThrottleRepository(),
    }),
    ttl,
    now: () => NOW,
  });
  return { repository, emailSender, auth };
}

describe("createAuth", () => {
  it("exposes every auth flow over one repository", async () => {
    const { repository, auth } = setup();

    const signup = await auth.signup(
      "user@example.com",
      "a perfectly fine passphrase",
    );
    expect(signup.outcome).toBe("accepted");
    expect(repository.users.size).toBe(1);
    expect(repository.verificationCodes.size).toBe(1);

    expect((await auth.resendCode(undefined)).outcome).toBe("invalid-session");
    expect((await auth.verifyCode(undefined, "000000", null)).outcome).toBe(
      "invalid",
    );
    expect((await auth.login("nobody@example.com", "x", null)).outcome).toBe(
      "invalid",
    );
    expect((await auth.authenticate(undefined)).outcome).toBe("invalid");
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
    expect(
      await auth.currentUser("99999999-9999-4999-8999-999999999999"),
    ).toBeUndefined();
  });

  it("carries a signup through to a confirmed account with a session", async () => {
    const { repository, emailSender, auth } = setup();

    const signup = await auth.signup(
      "user@example.com",
      "a perfectly fine passphrase",
    );
    if (signup.outcome !== "accepted") throw new Error("expected accepted");
    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));
    const code = emailSender.sent[0]?.subject.match(/\d{6}/)?.[0] ?? "";

    const verified = await auth.verifyCode(signup.sessionToken, code, null);
    if (verified.outcome !== "verified") throw new Error("expected verified");

    const session = await auth.authenticate(verified.sessionToken);
    expect(session.outcome).toBe("authenticated");
    expect(repository.verificationCodes.size).toBe(0);
  });

  it("stamps the sessions it opens with the configured session ttl", async () => {
    const { repository, emailSender, auth } = setup(
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

    expect([...repository.sessions.values()]).toEqual([
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

  it("resolves the current user without the password hash", async () => {
    const { auth } = setup({
      users: [{ id: USER_ID, email: "a@b.com", passwordHash: "secret-hash" }],
    });

    expect(await auth.currentUser(USER_ID)).toEqual({
      id: USER_ID,
      email: "a@b.com",
    });
  });
});
