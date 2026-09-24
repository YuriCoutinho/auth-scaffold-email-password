import type { FastifyBaseLogger } from "fastify";
import {
  blockSecondsForFailures,
  THROTTLE_MAX_BLOCK_SECONDS,
} from "../../../lib/throttle.js";
import { hashThrottleKey } from "../../../lib/token-hash.js";
import type { CredentialThrottleRepository } from "./repository.js";

export type ThrottleCheck =
  | { outcome: "allowed" }
  | { outcome: "blocked"; retryAfterSeconds: number };

export interface CredentialThrottleDeps {
  repository: CredentialThrottleRepository;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createCredentialThrottle(deps: CredentialThrottleDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async check(key: string): Promise<ThrottleCheck> {
      const record = await deps.repository.findThrottleByKeyHash(
        hashThrottleKey(key),
      );
      const currentTime = now();
      if (!record?.blockedUntil || record.blockedUntil <= currentTime) {
        return { outcome: "allowed" };
      }
      // Ceiling, never floor: a remainder under a second still owes a wait, and
      // Retry-After has to be a whole number of seconds.
      const retryAfterSeconds = Math.ceil(
        (record.blockedUntil.getTime() - currentTime.getTime()) / 1000,
      );
      return { outcome: "blocked", retryAfterSeconds };
    },

    async registerFailure(key: string): Promise<void> {
      const keyHash = hashThrottleKey(key);
      const currentTime = now();
      const record = await deps.repository.findThrottleByKeyHash(keyHash);
      // A run of failures is what looks like a machine. Once the trail goes
      // cold past the longest block, the next mistake is an ordinary typo.
      const stale =
        !record ||
        currentTime.getTime() - record.lastFailedAt.getTime() >
          THROTTLE_MAX_BLOCK_SECONDS * 1000;
      const failedCount = stale ? 1 : record.failedCount + 1;
      const blockSeconds = blockSecondsForFailures(failedCount);
      const blockedUntil =
        blockSeconds > 0
          ? new Date(currentTime.getTime() + blockSeconds * 1000)
          : null;

      await deps.repository.upsertThrottleFailure({
        keyHash,
        failedCount,
        lastFailedAt: currentTime,
        blockedUntil,
      });

      if (blockedUntil) {
        // No key and no hash in the log: a stable digest is still a handle to
        // follow one person across events.
        deps.log?.warn(
          { failedCount, blockedUntil },
          "credential attempts throttled",
        );
      }
    },

    async reset(key: string): Promise<void> {
      await deps.repository.clearThrottle(hashThrottleKey(key));
    },
  };
}

export type CredentialThrottle = ReturnType<typeof createCredentialThrottle>;
