import { createHash, createHmac } from "node:crypto";

const HASH_ALGORITHM = "sha256";
const DIGEST_ENCODING = "hex";

function sha256Hex(value: string): string {
  return createHash(HASH_ALGORITHM).update(value).digest(DIGEST_ENCODING);
}

function hmacSha256Hex(secret: string, value: string): string {
  return createHmac(HASH_ALGORITHM, secret)
    .update(value)
    .digest(DIGEST_ENCODING);
}

// Six digits are a million candidates, so a plain digest is reversed by trying
// them all. The server secret is what a leaked row does not carry.
export function hashOtpCode(secret: string, code: string): string {
  return hmacSha256Hex(secret, code);
}

// Tokens carry 256 random bits: there is no candidate list to try, so a plain
// digest is enough.
export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}

// Emails are guessable, so the throttle key is keyed like an OTP code, and the
// table holds no digest a dictionary of addresses could match.
export function hashThrottleKey(secret: string, value: string): string {
  return hmacSha256Hex(secret, value);
}

// The verification token rides in a cookie like a session token, so it is
// stored the same way: only its digest reaches the database.
export function hashVerificationToken(token: string): string {
  return sha256Hex(token);
}
