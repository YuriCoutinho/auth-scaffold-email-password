import { and, eq, isNull, sql, TransactionRollbackError } from "drizzle-orm";
import { users, verificationCodes } from "../../../db/schema.js";
import {
  createDrizzleSessionRepository,
  type DatabaseOrTransaction,
} from "../sessions/drizzle-repository.js";
import type {
  AuthRepository,
  ConsumeVerificationCodeInput,
  VerificationCodeKey,
  VerificationPurpose,
} from "./repository.js";

const userColumns = {
  id: users.id,
  email: users.email,
  passwordHash: users.passwordHash,
  emailVerifiedAt: users.emailVerifiedAt,
};

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

// Consumption matches the token and the code the caller read, so a code
// rotated or reissued in between matches no row and the caller learns it lost.
async function consumeCode(
  tx: DatabaseOrTransaction,
  purpose: VerificationPurpose,
  input: ConsumeVerificationCodeInput,
): Promise<boolean> {
  const consumed = await tx
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
}

export function createDrizzleAuthRepository(
  db: DatabaseOrTransaction,
): AuthRepository {
  return {
    async findUserByEmail(email) {
      const rows = await db
        .select(userColumns)
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return rows[0];
    },

    async findUserById(id) {
      const rows = await db
        .select(userColumns)
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return rows[0];
    },

    async startSignup(user, code) {
      return await db.transaction(async (tx) => {
        // The WHERE on the conflict branch is what keeps a confirmed account
        // out of reach: its row is left alone and RETURNING comes back empty.
        const upserted = await tx
          .insert(users)
          .values(user)
          .onConflictDoUpdate({
            target: users.email,
            set: { passwordHash: user.passwordHash },
            setWhere: isNull(users.emailVerifiedAt),
          })
          .returning({ id: users.id });
        const userId = upserted[0]?.id;
        if (!userId) {
          return null;
        }
        const values = { userId, purpose: "signup" as const, ...code };
        await tx
          .insert(verificationCodes)
          .values(values)
          .onConflictDoUpdate({
            target: [verificationCodes.userId, verificationCodes.purpose],
            set: code,
          });
        return { userId };
      });
    },

    async findVerificationCode(key) {
      const rows = await db
        .select(verificationCodeColumns)
        .from(verificationCodes)
        .innerJoin(users, eq(users.id, verificationCodes.userId))
        .where(byKey(key))
        .limit(1);
      return rows[0];
    },

    async findVerificationCodeByTokenHash(purpose, tokenHash) {
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

    async saveVerificationCode(input) {
      const { userId, purpose, ...state } = input;
      await db
        .insert(verificationCodes)
        .values(input)
        .onConflictDoUpdate({
          target: [verificationCodes.userId, verificationCodes.purpose],
          set: state,
        });
    },

    async rotateVerificationToken(key, tokenHash) {
      await db.update(verificationCodes).set({ tokenHash }).where(byKey(key));
    },

    async restoreVerificationCode(key, failedCodeHash, previous) {
      await db
        .update(verificationCodes)
        .set(previous)
        .where(and(byKey(key), eq(verificationCodes.codeHash, failedCodeHash)));
    },

    async incrementVerificationAttempts(key) {
      await db
        .update(verificationCodes)
        .set({ codeAttempts: sql`${verificationCodes.codeAttempts} + 1` })
        .where(byKey(key));
    },

    // All-or-nothing: if anything fails, the code survives for a retry.
    async verifyEmail(input) {
      return await db
        .transaction(async (tx) => {
          // Consuming first makes the code row the serialization point: a second
          // request carrying the same code blocks on this delete and then
          // matches nothing.
          if (!(await consumeCode(tx, "signup", input))) {
            return false;
          }
          const confirmed = await tx
            .update(users)
            .set({ emailVerifiedAt: input.verifiedAt })
            .where(
              and(eq(users.id, input.userId), isNull(users.emailVerifiedAt)),
            )
            .returning({ id: users.id });
          if (confirmed.length === 0) {
            // A leftover signup code of a confirmed account must never turn
            // into a session without a password.
            tx.rollback();
          }
          await createDrizzleSessionRepository(tx).createSession({
            ...input.session,
            userId: input.userId,
          });
          return true;
        })
        .catch((error: unknown) => {
          if (error instanceof TransactionRollbackError) {
            return false;
          }
          throw error;
        });
    },

    // One transaction so the two writes cannot come apart: a new password with
    // the old sessions still alive is the exact state this flow prevents.
    async changePassword(input) {
      await db.transaction(async (tx) => {
        await createDrizzleSessionRepository(tx).deleteUserSessions({
          userId: input.userId,
          exceptSessionId: input.exceptSessionId,
        });
        await tx
          .update(users)
          .set({ passwordHash: input.passwordHash })
          .where(eq(users.id, input.userId));
      });
    },

    // One transaction, and every session goes before the insert so the
    // session this flow opens is not caught by its own sweep.
    async resetPassword(input) {
      return await db.transaction(async (tx) => {
        if (!(await consumeCode(tx, "password_reset", input))) {
          return false;
        }
        const sessionRepository = createDrizzleSessionRepository(tx);
        await sessionRepository.deleteUserSessions({ userId: input.userId });
        await tx
          .update(users)
          .set({ passwordHash: input.passwordHash })
          .where(eq(users.id, input.userId));
        await sessionRepository.createSession({
          ...input.session,
          userId: input.userId,
        });
        return true;
      });
    },
  };
}
