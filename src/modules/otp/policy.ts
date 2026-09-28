import { randomInt } from "node:crypto";

// Delivery policy shared by every flow that emails a code: the signup resend
// and the password reset, which is its own resend.
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_CODE_SEND_COUNT = 5;
export const MAX_CODE_ATTEMPTS = 5;

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
