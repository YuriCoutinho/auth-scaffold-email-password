import { THROTTLE_MAX_BLOCK_SECONDS } from "../../modules/credential-throttle/policy.js";

export const RETENTION_INTERVAL_SECONDS = 60 * 60;

// Rows go the moment they stop working: nothing is kept around to be counted
// later, because this database holds state, not history.
export interface RetentionCutoffs {
  // Sessions and codes whose expiry is at or before this instant.
  expiredAt: Date;
  // A trail this cold no longer extends a block: the next failure starts over.
  throttleFailedBefore: Date;
}

export function retentionCutoffs(now: Date): RetentionCutoffs {
  return {
    expiredAt: now,
    throttleFailedBefore: new Date(
      now.getTime() - THROTTLE_MAX_BLOCK_SECONDS * 1000,
    ),
  };
}
