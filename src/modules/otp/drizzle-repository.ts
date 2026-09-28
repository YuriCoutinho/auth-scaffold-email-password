import { and, eq, lte, sql } from "drizzle-orm";
import type { Executor } from "../../db/client.js";
import { users, verificationCodes } from "../../db/schema.js";
import type { OtpRepository, VerificationCodeKey } from "./repository.js";

const verificationCodeColumns = {
  userId: verificationCodes.userId,
  purpose: verificationCodes.purpose,
  tokenHash: verificationCodes.tokenHash,
  codeHash: verificationCodes.codeHash,
  codeAttempts: verificationCodes.codeAttempts,
  codeSendCount: verificationCodes.codeSendCount,
  issuedAt: verificationCodes.issuedAt,
  expiresAt: verificationCodes.expiresAt,
  email: users.email,
  passwordHash: users.passwordHash,
};

function byKey(key: VerificationCodeKey) {
  return and(
    eq(verificationCodes.userId, key.userId),
    eq(verificationCodes.purpose, key.purpose),
  );
}

export function createDrizzleOtpRepository(db: Executor): OtpRepository {
  return {
    async find(key) {
      const rows = await db
        .select(verificationCodeColumns)
        .from(verificationCodes)
        .innerJoin(users, eq(users.id, verificationCodes.userId))
        .where(byKey(key))
        .limit(1);
      return rows[0];
    },

    async findByTokenHash(purpose, tokenHash) {
      const rows = await db
        .select(verificationCodeColumns)
        .from(verificationCodes)
        .innerJoin(users, eq(users.id, verificationCodes.userId))
        .where(
          and(
            eq(verificationCodes.tokenHash, tokenHash),
            eq(verificationCodes.purpose, purpose),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async save(input) {
      const { userId, purpose, ...state } = input;
      await db
        .insert(verificationCodes)
        .values(input)
        .onConflictDoUpdate({
          target: [verificationCodes.userId, verificationCodes.purpose],
          set: state,
        });
    },

    async rotateToken(key, tokenHash) {
      await db.update(verificationCodes).set({ tokenHash }).where(byKey(key));
    },

    async restore(key, failedCodeHash, previous) {
      await db
        .update(verificationCodes)
        .set(previous)
        .where(and(byKey(key), eq(verificationCodes.codeHash, failedCodeHash)));
    },

    async incrementAttempts(key) {
      await db
        .update(verificationCodes)
        .set({ codeAttempts: sql`${verificationCodes.codeAttempts} + 1` })
        .where(byKey(key));
    },

    // Consumption matches the token and the code the caller read, so a code
    // rotated or reissued in between matches no row and the caller learns it
    // lost.
    async consume(purpose, input) {
      const consumed = await db
        .delete(verificationCodes)
        .where(
          and(
            byKey({ userId: input.userId, purpose }),
            eq(verificationCodes.tokenHash, input.tokenHash),
            eq(verificationCodes.codeHash, input.codeHash),
          ),
        )
        .returning({ userId: verificationCodes.userId });
      return consumed.length > 0;
    },

    async purgeExpired(at) {
      const deleted = await db
        .delete(verificationCodes)
        .where(lte(verificationCodes.expiresAt, at))
        .returning({ userId: verificationCodes.userId });
      return deleted.length;
    },
  };
}
