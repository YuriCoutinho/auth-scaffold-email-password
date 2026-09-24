import { describe, expect, it } from "vitest";
import {
  generateToken,
  MAX_CODE_ATTEMPTS,
  MAX_CODE_SEND_COUNT,
  RESEND_COOLDOWN_SECONDS,
} from "../../src/lib/session.js";

describe("generateToken", () => {
  it("returns 43-char base64url tokens (256 bits)", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("returns unique tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, generateToken));
    expect(tokens.size).toBe(100);
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
