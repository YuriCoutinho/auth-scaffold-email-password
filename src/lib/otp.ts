import { randomBytes, randomInt } from "node:crypto";

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function generateSignupSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
