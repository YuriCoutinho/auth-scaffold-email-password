import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { emailOutbox } from "../../../db/schema.js";
import type { DatabaseOrTransaction } from "../sessions/drizzle-repository.js";
import type { EmailOutboxRepository } from "./repository.js";

const claimedColumns = {
  id: emailOutbox.id,
  type: emailOutbox.type,
  recipient: emailOutbox.recipient,
  subject: emailOutbox.subject,
  html: emailOutbox.html,
  text: emailOutbox.text,
  attempts: emailOutbox.attempts,
};

// The adapter also runs inside a transaction opened elsewhere, which is what
// keeps a queued email and the domain write that caused it in one commit.
export function createDrizzleEmailOutboxRepository(
  db: DatabaseOrTransaction,
): EmailOutboxRepository {
  return {
    async enqueue(message) {
      await db.insert(emailOutbox).values(message);
    },

    // FOR UPDATE SKIP LOCKED picks only rows no other worker holds, and the
    // update in the same transaction leases them, so two workers never send
    // the same email and no row stays claimed past its lease.
    async claimDue(input) {
      return await db.transaction(async (tx) => {
        const due = await tx
          .select({ id: emailOutbox.id })
          .from(emailOutbox)
          .where(
            and(
              eq(emailOutbox.status, "pending"),
              lte(emailOutbox.nextAttemptAt, input.now),
            ),
          )
          .orderBy(asc(emailOutbox.nextAttemptAt), asc(emailOutbox.id))
          .limit(input.limit)
          .for("update", { skipLocked: true });

        if (due.length === 0) {
          return [];
        }

        return await tx
          .update(emailOutbox)
          .set({
            nextAttemptAt: new Date(
              input.now.getTime() + input.leaseSeconds * 1000,
            ),
          })
          .where(
            inArray(
              emailOutbox.id,
              due.map((row) => row.id),
            ),
          )
          .returning(claimedColumns);
      });
    },

    async markSent(id, at) {
      await db
        .update(emailOutbox)
        .set({ status: "sent", sentAt: at })
        .where(eq(emailOutbox.id, id));
    },

    // lastError holds the error message only, never a provider response body,
    // because bodies can echo the recipient address.
    async reschedule(input) {
      await db
        .update(emailOutbox)
        .set({
          attempts: input.attempts,
          nextAttemptAt: input.nextAttemptAt,
          lastError: input.lastError,
        })
        .where(eq(emailOutbox.id, input.id));
    },

    async giveUp(input) {
      await db
        .update(emailOutbox)
        .set({
          status: "failed",
          attempts: input.attempts,
          lastError: input.lastError,
          nextAttemptAt: input.at,
        })
        .where(eq(emailOutbox.id, input.id));
    },
  };
}
