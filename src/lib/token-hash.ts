import { createHash } from "node:crypto";

const HASH_ALGORITHM = "sha256";
const DIGEST_ENCODING = "hex";

function sha256Hex(value: string): string {
  return createHash(HASH_ALGORITHM).update(value).digest(DIGEST_ENCODING);
}

// SHA-256 is enough for OTP codes and session tokens: brute-force protection
// comes from attempts/expiry and token entropy, not hash cost.
export function hashOtpCode(code: string): string {
  return sha256Hex(code);
}

export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}
