import { createHash } from "node:crypto";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// SHA-256 is enough for OTP codes and session tokens: brute-force protection
// comes from attempts/expiry and token entropy, not hash cost.
export function hashOtpCode(code: string): string {
  return sha256Hex(code);
}

export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}
