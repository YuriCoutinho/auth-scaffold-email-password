import { describe, expect, it } from "vitest";
import { generateToken } from "../../src/lib/token.js";

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
