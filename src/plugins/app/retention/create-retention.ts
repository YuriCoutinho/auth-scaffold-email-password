import type { FastifyBaseLogger } from "fastify";
import { retentionCutoffs } from "../../../lib/retention.js";
import type { PurgeCounts, RetentionRepository } from "./repository.js";

export interface RetentionDeps {
  repository: RetentionRepository;
  log?: Pick<FastifyBaseLogger, "info" | "error">;
  now?: () => Date;
}

export function createRetention(deps: RetentionDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    // Never rejects: a failed sweep is retried by the next tick, and an
    // unhandled rejection from a timer would take the process down.
    async sweep(): Promise<PurgeCounts | null> {
      try {
        const counts = await deps.repository.purge(retentionCutoffs(now()));
        deps.log?.info(counts, "retention sweep finished");
        return counts;
      } catch (error) {
        deps.log?.error({ err: error }, "retention sweep failed");
        return null;
      }
    },
  };
}

export type Retention = ReturnType<typeof createRetention>;
