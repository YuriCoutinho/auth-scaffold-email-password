import { describe, expect, it } from "vitest";
import {
  generateOtpCode,
  generateSignupSessionToken,
} from "../../src/lib/otp.js";

describe("generateOtpCode", () => {
  it("always returns exactly 6 digits, zero-padded", () => {
    for (let i = 0; i < 1000; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe("generateSignupSessionToken", () => {
  it("returns 43-char base64url tokens (256 bits)", () => {
    const token = generateSignupSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("returns unique tokens", () => {
    const tokens = new Set(
      Array.from({ length: 100 }, generateSignupSessionToken),
    );
    expect(tokens.size).toBe(100);
  });
});
