import { eq } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import { credentialThrottle } from "../../../db/schema.js";
import type { CredentialThrottleRepository } from "./repository.js";

export function createDrizzleCredentialThrottleRepository(
  db: Database,
): CredentialThrottleRepository {
  return {
    async findThrottleByKeyHash(keyHash) {
      const rows = await db
        .select({
          failedCount: credentialThrottle.failedCount,
          lastFailedAt: credentialThrottle.lastFailedAt,
        })
        .from(credentialThrottle)
        .where(eq(credentialThrottle.keyHash, keyHash))
        .limit(1);
      return rows[0];
    },

    async upsertThrottleFailure(input) {
      await db
        .insert(credentialThrottle)
        .values(input)
        .onConflictDoUpdate({
          target: credentialThrottle.keyHash,
          set: {
            failedCount: input.failedCount,
            lastFailedAt: input.lastFailedAt,
          },
        });
    },

    async clearThrottle(keyHash) {
      await db
        .delete(credentialThrottle)
        .where(eq(credentialThrottle.keyHash, keyHash));
    },
  };
}
