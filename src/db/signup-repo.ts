import { eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { authUsers, pendingSignups } from "./schema.js";

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
        .select({ id: authUsers.id })
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
  };
}

export type SignupRepo = ReturnType<typeof createSignupRepo>;
