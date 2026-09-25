import { and, eq, isNull, notExists } from "drizzle-orm";
import type { Executor } from "../../db/client.js";
import { users, verificationCodes } from "../../db/schema.js";
import type { UsersRepository } from "./repository.js";

const userColumns = {
  id: users.id,
  email: users.email,
  passwordHash: users.passwordHash,
  emailVerifiedAt: users.emailVerifiedAt,
};

export function createDrizzleUsersRepository(db: Executor): UsersRepository {
  return {
    async findByEmail(email) {
      const rows = await db
        .select(userColumns)
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return rows[0];
    },

    async findById(id) {
      const rows = await db
        .select(userColumns)
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return rows[0];
    },

    async upsertUnverified(input) {
      // The WHERE on the conflict branch is what keeps a confirmed account
      // out of reach: its row is left alone and RETURNING comes back empty.
      const upserted = await db
        .insert(users)
        .values(input)
        .onConflictDoUpdate({
          target: users.email,
          set: { passwordHash: input.passwordHash },
          setWhere: isNull(users.emailVerifiedAt),
        })
        .returning({ id: users.id });
      const userId = upserted[0]?.id;
      return userId ? { userId } : null;
    },

    async markVerified(id, at) {
      const confirmed = await db
        .update(users)
        .set({ emailVerifiedAt: at })
        .where(and(eq(users.id, id), isNull(users.emailVerifiedAt)))
        .returning({ id: users.id });
      return confirmed.length > 0;
    },

    async setPasswordHash(id, passwordHash) {
      await db.update(users).set({ passwordHash }).where(eq(users.id, id));
    },

    // Runs after the otp module's own purge so an abandoned signup has none
    // left. An account that still holds any code is mid-signup, which is what
    // keeps this from deleting it under a concurrent request.
    async purgeAbandonedUnverified() {
      const deleted = await db
        .delete(users)
        .where(
          and(
            isNull(users.emailVerifiedAt),
            notExists(
              db
                .select({ userId: verificationCodes.userId })
                .from(verificationCodes)
                .where(eq(verificationCodes.userId, users.id)),
            ),
          ),
        )
        .returning({ id: users.id });
      return deleted.length;
    },
  };
}
