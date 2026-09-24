import type { RetentionCutoffs } from "../../../lib/retention.js";

export interface PurgeCounts {
  sessions: number;
  verificationCodes: number;
  unverifiedUsers: number;
  throttleTrails: number;
}

export interface RetentionRepository {
  purge(cutoffs: RetentionCutoffs): Promise<PurgeCounts>;
}
