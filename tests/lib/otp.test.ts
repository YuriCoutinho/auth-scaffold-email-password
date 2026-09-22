import { describe, expect, it } from "vitest";
import { generateOtpCode } from "../../src/lib/otp.js";

describe("generateOtpCode", () => {
  it("always returns exactly 6 digits, zero-padded", () => {
    for (let i = 0; i < 1000; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });
});
