import { randomBytes } from "node:crypto";

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SIGNUP_TTL_SECONDS = 15 * 60;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

// Same entropy and encoding as a session token; kept as its own name so call
// sites say which token they mint.
export function generateSignupSessionToken(): string {
  return generateSessionToken();
}

// Only an active revocation carries a reason. Expiry is not one: it lives in
// expires_at and is checked on its own, so it never writes this column.
export const REVOKED_REASONS = [
  "user_logout",
  "logout_all",
  "session_revoked",
] as const;

export type RevokedReason = (typeof REVOKED_REASONS)[number];
