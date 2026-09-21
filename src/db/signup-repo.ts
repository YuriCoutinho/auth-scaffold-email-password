import { eq, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { authUsers, pendingSignups, profiles, sessions } from "./schema.js";

export interface UpsertPendingSignupInput {
  email: string;
  passwordHash: string;
  codeHash: string;
  signupSessionToken: string;
  expiresAt: Date;
  now: Date;
}

export function createSignupRepo(db: Database) {
  return {
    async findAuthUserByEmail(email: string) {
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

    async findPendingSignupByEmail(email: string) {
      const rows = await db
        .select({
          signupSessionToken: pendingSignups.signupSessionToken,
          expiresAt: pendingSignups.expiresAt,
        })
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

    // codeSendCount = 0 means no email was delivered for the current code,
    // so a future resend must treat it as free of cooldown/quota.
    async resetPendingSignupSendState(email: string) {
      await db
        .update(pendingSignups)
        .set({ codeSendCount: 0 })
        .where(eq(pendingSignups.email, email));
    },

    async findPendingSignupBySessionToken(token: string) {
      const rows = await db
        .select({
          id: pendingSignups.id,
          email: pendingSignups.email,
          passwordHash: pendingSignups.passwordHash,
          codeHash: pendingSignups.codeHash,
          codeAttempts: pendingSignups.codeAttempts,
          lastSentAt: pendingSignups.lastSentAt,
          codeSendCount: pendingSignups.codeSendCount,
          expiresAt: pendingSignups.expiresAt,
        })
        .from(pendingSignups)
        .where(eq(pendingSignups.signupSessionToken, token))
        .limit(1);
      return rows[0];
    },

    // Also used to restore the previous state when delivery fails.
    async updatePendingSignupResendState(
      token: string,
      state: {
        codeHash: string;
        expiresAt: Date;
        codeAttempts: number;
        lastSentAt: Date;
        codeSendCount: number;
      },
    ) {
      await db
        .update(pendingSignups)
        .set(state)
        .where(eq(pendingSignups.signupSessionToken, token));
    },

    async incrementCodeAttempts(signupSessionToken: string) {
      await db
        .update(pendingSignups)
        .set({ codeAttempts: sql`${pendingSignups.codeAttempts} + 1` })
        .where(eq(pendingSignups.signupSessionToken, signupSessionToken));
    },

    // All-or-nothing promotion: if anything fails, the pending signup (and its
    // still-valid code) survives for a retry.
    async promotePendingSignup(input: {
      email: string;
      passwordHash: string;
      signupSessionToken: string;
      sessionTokenHash: string;
      deviceLabel: string | null;
      sessionExpiresAt: Date;
    }) {
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
        await tx.insert(sessions).values({
          userId: user.id,
          tokenHash: input.sessionTokenHash,
          deviceLabel: input.deviceLabel,
          expiresAt: input.sessionExpiresAt,
        });
        await tx.insert(profiles).values({ userId: user.id });
        return user;
      });
    },

    async createSession(input: {
      userId: number;
      tokenHash: string;
      deviceLabel: string | null;
      expiresAt: Date;
    }) {
      await db.insert(sessions).values(input);
    },
  };
}

export type SignupRepo = ReturnType<typeof createSignupRepo>;
