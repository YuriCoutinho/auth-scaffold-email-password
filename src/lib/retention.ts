import { THROTTLE_MAX_BLOCK_SECONDS } from "./throttle.js";
import { issuedAfter, type TtlPolicy } from "./ttl.js";

export const RETENTION_INTERVAL_SECONDS = 60 * 60;

// An expired session is dead the moment it expires; the extra day only keeps
// the sweep from racing a request that read the row an instant before.
export const SESSION_GRACE_SECONDS = 24 * 60 * 60;

// Codes, unconfirmed accounts and throttle trails outlive their validity by
// this factor, which leaves room to count them after they stop working.
export const RETENTION_MULTIPLIER = 3;

export interface RetentionCutoffs {
  sessionsCreatedBefore: Date;
  signupCodesIssuedBefore: Date;
  passwordResetCodesIssuedBefore: Date;
  unverifiedUsersCreatedBefore: Date;
  throttleFailedBefore: Date;
}

export function retentionCutoffs(ttl: TtlPolicy, now: Date): RetentionCutoffs {
  const signupCutoff = issuedAfter(
    ttl.signupCodeSeconds * RETENTION_MULTIPLIER,
    now,
  );
  return {
    sessionsCreatedBefore: issuedAfter(
      ttl.sessionSeconds + SESSION_GRACE_SECONDS,
      now,
    ),
    signupCodesIssuedBefore: signupCutoff,
    passwordResetCodesIssuedBefore: issuedAfter(
      ttl.passwordResetCodeSeconds * RETENTION_MULTIPLIER,
      now,
    ),
    unverifiedUsersCreatedBefore: signupCutoff,
    throttleFailedBefore: issuedAfter(
      THROTTLE_MAX_BLOCK_SECONDS * RETENTION_MULTIPLIER,
      now,
    ),
  };
}
