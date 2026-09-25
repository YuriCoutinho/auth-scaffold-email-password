import { describe, expect, it } from "vitest";
import {
  generateOtpCode,
  MAX_CODE_ATTEMPTS,
  MAX_CODE_SEND_COUNT,
  RESEND_COOLDOWN_SECONDS,
} from "../../../src/modules/otp/policy.js";

describe("generateOtpCode", () => {
  it("always returns exactly 6 digits, zero-padded", () => {
    for (let i = 0; i < 1000; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe("code delivery policy", () => {
  it("waits one minute between sends", () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
  });

  it("caps sends and attempts at five per code", () => {
    expect(MAX_CODE_SEND_COUNT).toBe(5);
    expect(MAX_CODE_ATTEMPTS).toBe(5);
  });
});
