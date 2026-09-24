import type {
  CredentialThrottleRepository,
  ThrottleRecord,
} from "../../../src/plugins/app/credential-throttle/repository.js";

export interface InMemoryCredentialThrottleRepository
  extends CredentialThrottleRepository {
  rows: Map<string, ThrottleRecord>;
}

export function createInMemoryCredentialThrottleRepository(
  seed: Map<string, ThrottleRecord> = new Map(),
): InMemoryCredentialThrottleRepository {
  const rows = seed;
  return {
    rows,
    async findThrottleByKeyHash(keyHash) {
      return rows.get(keyHash);
    },
    async upsertThrottleFailure(input) {
      rows.set(input.keyHash, {
        failedCount: input.failedCount,
        lastFailedAt: input.lastFailedAt,
      });
    },
    async clearThrottle(keyHash) {
      rows.delete(keyHash);
    },
  };
}
