import { THROTTLE_MAX_BLOCK_SECONDS } from "./throttle.js";
import type { TtlPolicy } from "./ttl.js";

export const RETENTION_INTERVAL_SECONDS = 60 * 60;

// An expired session is dead the moment it expires; the extra day only keeps
// the sweep from racing a request that read the row an instant before.
export const SESSION_GRACE_SECONDS = 24 * 60 * 60;

// Codes outlive their expiry by this much, which leaves room to count them
// after they stop working.
export const CODE_GRACE_SECONDS = 30 * 60;

// Unconfirmed accounts and throttle trails outlive their window by this
// factor, for the same reason.
export const RETENTION_MULTIPLIER = 3;

export interface RetentionCutoffs {
  sessionsExpiredBefore: Date;
  verificationCodesExpiredBefore: Date;
  unverifiedUsersCreatedBefore: Date;
  throttleFailedBefore: Date;
}

const secondsBefore = (now: Date, seconds: number) =>
  new Date(now.getTime() - seconds * 1000);

export function retentionCutoffs(ttl: TtlPolicy, now: Date): RetentionCutoffs {
  return {
    sessionsExpiredBefore: secondsBefore(now, SESSION_GRACE_SECONDS),
    verificationCodesExpiredBefore: secondsBefore(now, CODE_GRACE_SECONDS),
    unverifiedUsersCreatedBefore: secondsBefore(
      now,
      ttl.signupCodeSeconds * RETENTION_MULTIPLIER,
    ),
    throttleFailedBefore: secondsBefore(
      now,
      THROTTLE_MAX_BLOCK_SECONDS * RETENTION_MULTIPLIER,
    ),
  };
}
