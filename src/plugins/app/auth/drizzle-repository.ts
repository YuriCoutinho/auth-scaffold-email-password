import { and, eq, sql } from "drizzle-orm";
import {
  authUsers,
  passwordResets,
  pendingSignups,
  profiles,
} from "../../../db/schema.js";
import {
  createDrizzleSessionRepository,
  type DatabaseOrTransaction,
} from "../sessions/drizzle-repository.js";
import type {
  AuthRepository,
  ChangeUserPasswordInput,
  PasswordResetSendState,
  PendingSignupResendState,
  PromotePendingSignupInput,
  ResetUserPasswordInput,
  UpsertPasswordResetInput,
  UpsertPendingSignupInput,
} from "./repository.js";

const pendingSignupColumns = {
  id: pendingSignups.id,
  email: pendingSignups.email,
  passwordHash: pendingSignups.passwordHash,
  codeHash: pendingSignups.codeHash,
  signupSessionToken: pendingSignups.signupSessionToken,
  codeAttempts: pendingSignups.codeAttempts,
  lastSentAt: pendingSignups.lastSentAt,
  codeSendCount: pendingSignups.codeSendCount,
  expiresAt: pendingSignups.expiresAt,
};

const passwordResetColumns = {
  id: passwordResets.id,
  userId: passwordResets.userId,
  email: authUsers.email,
  passwordHash: authUsers.passwordHash,
  codeHash: passwordResets.codeHash,
  resetSessionToken: passwordResets.resetSessionToken,
  codeAttempts: passwordResets.codeAttempts,
  lastSentAt: passwordResets.lastSentAt,
  codeSendCount: passwordResets.codeSendCount,
  expiresAt: passwordResets.expiresAt,
};

export function createDrizzleAuthRepository(
  db: DatabaseOrTransaction,
): AuthRepository {
  return {
    async findAuthUserByEmail(email) {
      const rows = await db
        .select({
          id: authUsers.id,
          publicId: authUsers.publicId,
          passwordHash: authUsers.passwordHash,
        })
        .from(authUsers)
        .where(eq(authUsers.email, email))
        .limit(1);
      return rows[0];
    },

    async findPendingSignupByEmail(email) {
      const rows = await db
        .select(pendingSignupColumns)
        .from(pendingSignups)
        .where(eq(pendingSignups.email, email))
        .limit(1);
      return rows[0];
    },

    // Atomic replace: defaults only fire on real inserts, so the update
    // clause must renew createdAt/lastSentAt/codeSendCount explicitly.
    async upsertPendingSignup(input: UpsertPendingSignupInput) {
      const rows = await db
        .insert(pendingSignups)
        .values({
          email: input.email,
          passwordHash: input.passwordHash,
          codeHash: input.codeHash,
          signupSessionToken: input.signupSessionToken,
          expiresAt: input.expiresAt,
        })
        .onConflictDoUpdate({
          target: pendingSignups.email,
          set: {
            passwordHash: input.passwordHash,
            codeHash: input.codeHash,
            signupSessionToken: input.signupSessionToken,
            expiresAt: input.expiresAt,
            codeAttempts: 0,
            createdAt: input.now,
            lastSentAt: input.now,
            codeSendCount: 1,
          },
        })
        .returning({ id: pendingSignups.id });
      return rows[0] as { id: number };
    },

    async markPendingSignupUndelivered(email) {
      await db
        .update(pendingSignups)
        .set({ codeSendCount: 0 })
        .where(eq(pendingSignups.email, email));
    },

    async findPendingSignupBySessionToken(token) {
      const rows = await db
        .select(pendingSignupColumns)
        .from(pendingSignups)
        .where(eq(pendingSignups.signupSessionToken, token))
        .limit(1);
      return rows[0];
    },

    // Also used to restore the previous state when delivery fails.
    async updatePendingSignupResendState(
      token,
      state: PendingSignupResendState,
    ) {
      await db
        .update(pendingSignups)
        .set(state)
        .where(eq(pendingSignups.signupSessionToken, token));
    },

    async rotatePendingSignupToken(email, nextToken) {
      await db
        .update(pendingSignups)
        .set({ signupSessionToken: nextToken })
        .where(eq(pendingSignups.email, email));
    },

    async incrementCodeAttempts(signupSessionToken) {
      await db
        .update(pendingSignups)
        .set({ codeAttempts: sql`${pendingSignups.codeAttempts} + 1` })
        .where(eq(pendingSignups.signupSessionToken, signupSessionToken));
    },

    // All-or-nothing promotion: if anything fails, the pending signup (and its
    // still-valid code) survives for a retry.
    async promotePendingSignup(input: PromotePendingSignupInput) {
      return await db.transaction(async (tx) => {
        const users = await tx
          .insert(authUsers)
          .values({ email: input.email, passwordHash: input.passwordHash })
          .returning({ id: authUsers.id, publicId: authUsers.publicId });
        const user = users[0] as { id: number; publicId: string };
        await tx
          .delete(pendingSignups)
          .where(
            eq(pendingSignups.signupSessionToken, input.signupSessionToken),
          );
        await createDrizzleSessionRepository(tx).createSession({
          userId: user.id,
          tokenHash: input.sessionTokenHash,
          deviceLabel: input.deviceLabel,
          expiresAt: input.sessionExpiresAt,
        });
        await tx.insert(profiles).values({ userId: user.id });
        return user;
      });
    },

    async findAuthUserById(id) {
      const rows = await db
        .select({ publicId: authUsers.publicId, email: authUsers.email })
        .from(authUsers)
        .where(eq(authUsers.id, id))
        .limit(1);
      return rows[0];
    },

    async findAuthUserCredentialsById(id) {
      const rows = await db
        .select({
          id: authUsers.id,
          email: authUsers.email,
          passwordHash: authUsers.passwordHash,
        })
        .from(authUsers)
        .where(eq(authUsers.id, id))
        .limit(1);
      return rows[0];
    },

    // One transaction so the two writes cannot come apart: a new password with
    // the old sessions still alive is the exact state this flow prevents.
    async changeUserPassword(input: ChangeUserPasswordInput) {
      await db.transaction(async (tx) => {
        await createDrizzleSessionRepository(tx).revokeAllUserSessions({
          userId: input.userId,
          revokedAt: input.revokedAt,
          revokedReason: input.revokedReason,
          exceptSessionId: input.exceptSessionId,
        });
        await tx
          .update(authUsers)
          .set({ passwordHash: input.passwordHash })
          .where(eq(authUsers.id, input.userId));
      });
    },

    async findPasswordResetByUserId(userId) {
      const rows = await db
        .select(passwordResetColumns)
        .from(passwordResets)
        .innerJoin(authUsers, eq(authUsers.id, passwordResets.userId))
        .where(eq(passwordResets.userId, userId))
        .limit(1);
      return rows[0];
    },

    // Atomic replace, same shape as upsertPendingSignup: defaults only fire on
    // real inserts, so the update clause renews the counters explicitly.
    async upsertPasswordReset(input: UpsertPasswordResetInput) {
      const rows = await db
        .insert(passwordResets)
        .values({
          userId: input.userId,
          codeHash: input.codeHash,
          resetSessionToken: input.resetSessionToken,
          expiresAt: input.expiresAt,
        })
        .onConflictDoUpdate({
          target: passwordResets.userId,
          set: {
            codeHash: input.codeHash,
            resetSessionToken: input.resetSessionToken,
            expiresAt: input.expiresAt,
            codeAttempts: 0,
            createdAt: input.now,
            lastSentAt: input.now,
            codeSendCount: 1,
          },
        })
        .returning({ id: passwordResets.id });
      return rows[0] as { id: number };
    },

    async findPasswordResetBySessionToken(token) {
      const rows = await db
        .select(passwordResetColumns)
        .from(passwordResets)
        .innerJoin(authUsers, eq(authUsers.id, passwordResets.userId))
        .where(eq(passwordResets.resetSessionToken, token))
        .limit(1);
      return rows[0];
    },

    // The state carries the new token while the WHERE matches the row by user,
    // which is what rotates the identifier in a single write that cannot miss.
    async updatePasswordResetSendState(userId, state: PasswordResetSendState) {
      await db
        .update(passwordResets)
        .set(state)
        .where(eq(passwordResets.userId, userId));
    },

    async restorePasswordResetSendState(userId, state: PasswordResetSendState) {
      await db
        .update(passwordResets)
        .set(state)
        .where(
          and(
            eq(passwordResets.userId, userId),
            eq(passwordResets.resetSessionToken, state.resetSessionToken),
          ),
        );
    },

    async incrementPasswordResetAttempts(token) {
      await db
        .update(passwordResets)
        .set({ codeAttempts: sql`${passwordResets.codeAttempts} + 1` })
        .where(eq(passwordResets.resetSessionToken, token));
    },

    // One transaction, and the revocation runs before the insert so the
    // session this flow opens is not caught by its own sweep.
    async resetUserPassword(input: ResetUserPasswordInput) {
      await db.transaction(async (tx) => {
        const sessionRepository = createDrizzleSessionRepository(tx);
        await sessionRepository.revokeAllUserSessions({
          userId: input.userId,
          revokedAt: input.revokedAt,
          revokedReason: input.revokedReason,
        });
        await tx
          .update(authUsers)
          .set({ passwordHash: input.passwordHash })
          .where(eq(authUsers.id, input.userId));
        await tx
          .delete(passwordResets)
          .where(eq(passwordResets.resetSessionToken, input.resetSessionToken));
        await sessionRepository.createSession({
          userId: input.userId,
          tokenHash: input.sessionTokenHash,
          deviceLabel: input.deviceLabel,
          expiresAt: input.sessionExpiresAt,
        });
      });
    },
  };
}
