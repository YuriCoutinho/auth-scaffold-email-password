import { describe, expect, it } from "vitest";
import {
  hashOtpCode,
  hashSessionToken,
  hashThrottleKey,
} from "../../src/lib/token-hash.js";

// SHA-256 of "123456", from a known vector
const SHA256_123456 =
  "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92";

describe("hashOtpCode", () => {
  it("returns the SHA-256 hex digest of the code", () => {
    expect(hashOtpCode("123456")).toBe(SHA256_123456);
  });

  it("is deterministic", () => {
    expect(hashOtpCode("654321")).toBe(hashOtpCode("654321"));
  });

  it("produces different digests for different codes", () => {
    expect(hashOtpCode("123456")).not.toBe(hashOtpCode("123457"));
  });
});

describe("hashSessionToken", () => {
  it("returns the SHA-256 hex digest of the token", () => {
    expect(hashSessionToken("123456")).toBe(SHA256_123456);
  });

  it("returns 64 lowercase hex chars for high-entropy tokens", () => {
    const digest = hashSessionToken("a".repeat(43));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashThrottleKey", () => {
  it("returns a stable sha-256 hex digest", () => {
    expect(hashThrottleKey("foo@gmail.com")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashThrottleKey("foo@gmail.com")).toBe(
      hashThrottleKey("foo@gmail.com"),
    );
  });

  it("does not keep the address recoverable from the digest", () => {
    expect(hashThrottleKey("foo@gmail.com")).not.toContain("foo");
  });
});
