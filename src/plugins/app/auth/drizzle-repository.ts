import { eq, sql } from "drizzle-orm";
import { authUsers, pendingSignups, profiles } from "../../../db/schema.js";
import { createDrizzleEmailOutboxRepository } from "../email-outbox/drizzle-repository.js";
import {
  createDrizzleSessionRepository,
  type DatabaseOrTransaction,
} from "../sessions/drizzle-repository.js";
import type {
  AuthRepository,
  ChangeUserPasswordInput,
  PendingSignupResendState,
  PromotePendingSignupInput,
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

    // One transaction for the row and its email: a signup that rolls back
    // leaves nothing queued, and a queued code always has a signup to confirm.
    async upsertPendingSignupAndQueueEmail(input) {
      return await db.transaction(async (tx) => {
        const rows = await tx
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
        await createDrizzleEmailOutboxRepository(tx).enqueue(input.message);
        return rows[0] as { id: number };
      });
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

    async updatePendingSignupResendStateAndQueueEmail(
      token,
      state: PendingSignupResendState,
      message,
    ) {
      await db.transaction(async (tx) => {
        await tx
          .update(pendingSignups)
          .set(state)
          .where(eq(pendingSignups.signupSessionToken, token));
        await createDrizzleEmailOutboxRepository(tx).enqueue(message);
      });
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

    // One transaction so the writes cannot come apart: a new password with the
    // old sessions still alive is the state this flow prevents, and a notice
    // about a change that never happened is the other one.
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
        await createDrizzleEmailOutboxRepository(tx).enqueue(input.message);
      });
    },
  };
}
