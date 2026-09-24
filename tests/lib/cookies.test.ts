import { describe, expect, it } from "vitest";
import { cookiePolicy } from "../../src/lib/cookies.js";
import type { TtlPolicy } from "../../src/lib/ttl.js";

const TTL: TtlPolicy = {
  sessionSeconds: 1000,
  signupCodeSeconds: 100,
  passwordResetCodeSeconds: 200,
};

describe("cookiePolicy", () => {
  const policy = cookiePolicy(TTL);

  it("gives each cookie the lifetime of the credential it carries", () => {
    expect(policy.session.options.maxAge).toBe(1000);
    expect(policy.signupSession.options.maxAge).toBe(100);
    expect(policy.passwordReset.options.maxAge).toBe(200);
  });

  it("names the cookies and scopes the code cookies to /auth", () => {
    expect(policy.session).toMatchObject({
      name: "session",
      options: { path: "/" },
    });
    expect(policy.signupSession).toMatchObject({
      name: "signup_session",
      options: { path: "/auth" },
    });
    expect(policy.passwordReset).toMatchObject({
      name: "password_reset",
      options: { path: "/auth" },
    });
  });

  it("hardens every cookie", () => {
    for (const spec of Object.values(policy)) {
      expect(spec.options).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: "strict",
      });
    }
  });
});
