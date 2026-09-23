import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  generateSignupSessionToken,
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
    expect(REVOKED_REASONS).toEqual(["user_logout"]);
  });
});
