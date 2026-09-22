import { randomBytes } from "node:crypto";

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

// Same entropy and encoding as a session token; kept as its own name so call
// sites say which token they mint.
export function generateSignupSessionToken(): string {
  return generateSessionToken();
}
