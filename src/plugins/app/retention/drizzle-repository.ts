import { and, eq, isNull, lt, notExists, or } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import {
  credentialThrottle,
  sessions,
  users,
  verificationCodes,
} from "../../../db/schema.js";
import type { RetentionRepository } from "./repository.js";

export function createDrizzleRetentionRepository(
  db: Database,
): RetentionRepository {
  return {
    async purge(cutoffs) {
      const deletedSessions = await db
        .delete(sessions)
        .where(lt(sessions.createdAt, cutoffs.sessionsCreatedBefore))
        .returning({ id: sessions.id });

      const deletedCodes = await db
        .delete(verificationCodes)
        .where(
          or(
            and(
              eq(verificationCodes.purpose, "signup"),
              lt(verificationCodes.issuedAt, cutoffs.signupCodesIssuedBefore),
            ),
            and(
              eq(verificationCodes.purpose, "password_reset"),
              lt(
                verificationCodes.issuedAt,
                cutoffs.passwordResetCodesIssuedBefore,
              ),
            ),
          ),
        )
        .returning({ userId: verificationCodes.userId });

      // Runs after the codes above so an abandoned signup has none left. An
      // account that still holds any code is mid-signup, which is what keeps
      // this from deleting it under a concurrent request.
      const deletedUsers = await db
        .delete(users)
        .where(
          and(
            isNull(users.emailVerifiedAt),
            lt(users.createdAt, cutoffs.unverifiedUsersCreatedBefore),
            notExists(
              db
                .select({ userId: verificationCodes.userId })
                .from(verificationCodes)
                .where(eq(verificationCodes.userId, users.id)),
            ),
          ),
        )
        .returning({ id: users.id });

      const deletedTrails = await db
        .delete(credentialThrottle)
        .where(
          lt(credentialThrottle.lastFailedAt, cutoffs.throttleFailedBefore),
        )
        .returning({ keyHash: credentialThrottle.keyHash });

      return {
        sessions: deletedSessions.length,
        verificationCodes: deletedCodes.length,
        unverifiedUsers: deletedUsers.length,
        throttleTrails: deletedTrails.length,
      };
    },
  };
}
