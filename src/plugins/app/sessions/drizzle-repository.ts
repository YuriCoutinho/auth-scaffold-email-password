import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import { sessions } from "../../../db/schema.js";
import type { SessionRepository } from "./repository.js";

// The adapter also runs inside a transaction opened elsewhere, which is what
// keeps the signup autologin atomic while the SQL for this table stays here.
export type DatabaseOrTransaction =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createDrizzleSessionRepository(
  db: DatabaseOrTransaction,
): SessionRepository {
  return {
    async createSession(input) {
      await db.insert(sessions).values(input);
    },

    async findSessionByTokenHash(tokenHash) {
      const rows = await db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          expiresAt: sessions.expiresAt,
          revokedAt: sessions.revokedAt,
        })
        .from(sessions)
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1);
      return rows[0];
    },

    async revokeSessionByTokenHash(tokenHash, revokedAt, revokedReason) {
      // The revoked_at IS NULL guard is what makes logout idempotent: a second
      // call matches no row instead of overwriting the first revocation.
      await db
        .update(sessions)
        .set({ revokedAt, revokedReason })
        .where(
          and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)),
        );
    },

    async revokeAllUserSessions(input) {
      // The revoked_at IS NULL guard keeps this idempotent and keeps the count
      // honest: a session revoked by an earlier call matches no row, so it is
      // neither overwritten nor counted again.
      const revoked = await db
        .update(sessions)
        .set({ revokedAt: input.revokedAt, revokedReason: input.revokedReason })
        .where(
          and(
            eq(sessions.userId, input.userId),
            isNull(sessions.revokedAt),
            input.exceptSessionId === undefined
              ? undefined
              : ne(sessions.id, input.exceptSessionId),
          ),
        )
        .returning({ id: sessions.id });

      return { revokedCount: revoked.length };
    },

    async revokeUserSessionByPublicId(input) {
      // Identification and authorization ride in the same WHERE, so a session
      // of another user matches no row instead of relying on a check the
      // caller might forget. The expiry condition keeps "revocable" and
      // "listed as active" the same definition.
      const revoked = await db
        .update(sessions)
        .set({ revokedAt: input.revokedAt, revokedReason: input.revokedReason })
        .where(
          and(
            eq(sessions.publicId, input.publicId),
            eq(sessions.userId, input.userId),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, input.now),
          ),
        )
        .returning({ id: sessions.id });

      return { revoked: revoked.length > 0 };
    },

    async listActiveUserSessions(input) {
      return db
        .select({
          id: sessions.id,
          publicId: sessions.publicId,
          deviceLabel: sessions.deviceLabel,
          createdAt: sessions.createdAt,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, input.userId),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, input.now),
          ),
        )
        .orderBy(desc(sessions.createdAt), desc(sessions.id));
    },
  };
}
