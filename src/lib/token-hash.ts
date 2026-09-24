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

// The throttle table keys its rows by this rather than by the address, so a
// table about abuse never holds an email at rest.
export function hashThrottleKey(value: string): string {
  return sha256Hex(value);
}

// The verification token rides in a cookie like a session token, so it is
// stored the same way: only its digest reaches the database.
export function hashVerificationToken(token: string): string {
  return sha256Hex(token);
}
