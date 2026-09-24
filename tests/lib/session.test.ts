import { describe, expect, it } from "vitest";
import {
  generatePasswordResetSessionToken,
  generateSessionToken,
  generateSignupSessionToken,
  PASSWORD_RESET_TTL_SECONDS,
  REVOKED_REASONS,
} from "../../src/lib/session.js";

describe.each([
  ["generateSessionToken", generateSessionToken],
  ["generateSignupSessionToken", generateSignupSessionToken],
])("%s", (_name, generate) => {
  it("returns 43-char base64url tokens (256 bits)", () => {
    expect(generate()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("returns unique tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, generate));
    expect(tokens.size).toBe(100);
  });
});

describe("REVOKED_REASONS", () => {
  it("lists the reasons a session can be actively revoked", () => {
    expect(REVOKED_REASONS).toEqual([
      "user_logout",
      "logout_all",
      "session_revoked",
      "password_changed",
      "password_reset",
    ]);
  });

  it("accepts logout_all as a revocation reason", () => {
    expect(REVOKED_REASONS).toContain("logout_all");
  });

  it("accepts session_revoked as a revocation reason", () => {
    expect(REVOKED_REASONS).toContain("session_revoked");
  });

  it("accepts password_changed as a revocation reason", () => {
    expect(REVOKED_REASONS).toContain("password_changed");
  });
});

describe("password reset", () => {
  it("expires the reset code in 15 minutes", () => {
    expect(PASSWORD_RESET_TTL_SECONDS).toBe(15 * 60);
  });

  it("mints a reset session token with the same entropy as a session token", () => {
    const token = generatePasswordResetSessionToken();
    expect(token).toMatch(/^[\w-]+$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("mints a different token on every call", () => {
    expect(generatePasswordResetSessionToken()).not.toBe(
      generatePasswordResetSessionToken(),
    );
  });

  it("lists password_reset as a revocation reason", () => {
    expect(REVOKED_REASONS).toContain("password_reset");
  });
});
