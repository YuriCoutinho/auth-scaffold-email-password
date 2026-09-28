import type { FastifyBaseLogger } from "fastify";
import type { CredentialThrottleService } from "../../modules/credential-throttle/service.js";
import type { OtpService } from "../../modules/otp/service.js";
import type { SessionsService } from "../../modules/sessions/service.js";
import type { UsersService } from "../../modules/users/service.js";
import { retentionCutoffs } from "./cutoffs.js";

export interface PurgeCounts {
  sessions: number;
  verificationCodes: number;
  unverifiedUsers: number;
  throttleTrails: number;
}

interface RetentionSweepDeps {
  sessions: Pick<SessionsService, "purgeExpired">;
  otp: Pick<OtpService, "purgeExpired">;
  users: Pick<UsersService, "purgeAbandonedUnverified">;
  credentialThrottle: Pick<CredentialThrottleService, "purgeStale">;
  log?: Pick<FastifyBaseLogger, "info" | "error">;
  now?: () => Date;
}

export function createRetentionSweep(deps: RetentionSweepDeps) {
  const now = deps.now ?? (() => new Date());
  // Never rejects: a failed sweep is retried by the next tick, and an
  // unhandled rejection from a timer would take the process down.
  return async (): Promise<PurgeCounts | null> => {
    try {
      const cutoffs = retentionCutoffs(now());
      const sessions = await deps.sessions.purgeExpired(cutoffs.expiredAt);
      const verificationCodes = await deps.otp.purgeExpired(cutoffs.expiredAt);
      // Runs after the codes above so an abandoned signup has none left.
      const unverifiedUsers = await deps.users.purgeAbandonedUnverified();
      const throttleTrails = await deps.credentialThrottle.purgeStale(
        cutoffs.throttleFailedBefore,
      );
      const counts = {
        sessions,
        verificationCodes,
        unverifiedUsers,
        throttleTrails,
      };
      deps.log?.info(counts, "retention sweep finished");
      return counts;
    } catch (error) {
      deps.log?.error({ err: error }, "retention sweep failed");
      return null;
    }
  };
}
