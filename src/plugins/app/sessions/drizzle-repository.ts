import { and, desc, eq, gt, ne } from "drizzle-orm";
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
        })
        .from(sessions)
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1);
      return rows[0];
    },

    async deleteSessionByTokenHash(tokenHash) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },

    async deleteUserSessions(input) {
      const deleted = await db
        .delete(sessions)
        .where(
          and(
            eq(sessions.userId, input.userId),
            input.exceptSessionId === undefined
              ? undefined
              : ne(sessions.id, input.exceptSessionId),
          ),
        )
        .returning({ id: sessions.id });

      return { deletedCount: deleted.length };
    },

    async deleteUserSession(input) {
      // Identification and authorization ride in the same WHERE, so a session
      // of another user matches no row instead of relying on a check the
      // caller might forget.
      const deleted = await db
        .delete(sessions)
        .where(
          and(eq(sessions.id, input.id), eq(sessions.userId, input.userId)),
        )
        .returning({ id: sessions.id });

      return { deleted: deleted.length > 0 };
    },

    async listUserSessions(input) {
      return db
        .select({
          id: sessions.id,
          deviceLabel: sessions.deviceLabel,
          createdAt: sessions.createdAt,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, input.userId),
            gt(sessions.expiresAt, input.activeAt),
          ),
        )
        .orderBy(desc(sessions.createdAt), desc(sessions.id));
    },
  };
}
