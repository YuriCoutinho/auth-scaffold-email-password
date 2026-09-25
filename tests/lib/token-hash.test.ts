import { describe, expect, it } from "vitest";
import {
  hashOtpCode,
  hashSessionToken,
  hashThrottleKey,
  hashVerificationToken,
} from "../../src/lib/token-hash.js";

// SHA-256 of "123456", from a known vector
const SHA256_123456 =
  "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92";

// RFC 4231, test case 2
const RFC4231_KEY = "Jefe";
const RFC4231_DATA = "what do ya want for nothing?";
const RFC4231_HMAC =
  "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";

describe("hashOtpCode", () => {
  it("returns the HMAC-SHA-256 hex digest keyed by the secret", () => {
    expect(hashOtpCode(RFC4231_KEY, RFC4231_DATA)).toBe(RFC4231_HMAC);
  });

  it("is not the plain SHA-256 of the code", () => {
    expect(hashOtpCode("secret", "123456")).not.toBe(SHA256_123456);
  });

  it("changes with the secret", () => {
    expect(hashOtpCode("secret-a", "123456")).not.toBe(
      hashOtpCode("secret-b", "123456"),
    );
  });

  it("is deterministic", () => {
    expect(hashOtpCode("secret", "654321")).toBe(
      hashOtpCode("secret", "654321"),
    );
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
  it("returns the HMAC-SHA-256 hex digest keyed by the secret", () => {
    expect(hashThrottleKey(RFC4231_KEY, RFC4231_DATA)).toBe(RFC4231_HMAC);
  });

  it("changes with the secret", () => {
    expect(hashThrottleKey("secret-a", "foo@gmail.com")).not.toBe(
      hashThrottleKey("secret-b", "foo@gmail.com"),
    );
  });
});

describe("hashVerificationToken", () => {
  it("returns the SHA-256 hex digest of the token", () => {
    expect(hashVerificationToken("123456")).toBe(SHA256_123456);
  });

  it("never returns the token itself", () => {
    const token = "a".repeat(43);
    expect(hashVerificationToken(token)).not.toBe(token);
    expect(hashVerificationToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});
