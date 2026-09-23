import { and, asc, eq, inArray, lt, lte, or } from "drizzle-orm";
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
  correlationId: emailOutbox.correlationId,
  expiresAt: emailOutbox.expiresAt,
  attempts: emailOutbox.attempts,
};

// What a row keeps once it is terminal: the envelope, so a delivery problem
// can still be investigated, and nothing of what it was going to say.
const clearedMessage = { subject: "", html: "", text: "" };

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

    // The message is cleared here, not at purge time: once the queue gives up,
    // the body will never be sent and only the envelope is worth keeping for an
    // investigation. nextAttemptAt doubles as the moment of the give-up, which
    // is what the purge later measures the retention window from.
    async giveUp(input) {
      await db
        .update(emailOutbox)
        .set({
          status: "failed",
          attempts: input.attempts,
          lastError: input.lastError,
          nextAttemptAt: input.at,
          ...clearedMessage,
        })
        .where(eq(emailOutbox.id, input.id));
    },

    // Same terminal treatment as a give-up, under its own status: folding the
    // two together would erase the difference between a provider that refuses
    // and a delivery that took longer than the content stayed valid.
    async expire(input) {
      await db
        .update(emailOutbox)
        .set({
          status: "expired",
          nextAttemptAt: input.at,
          ...clearedMessage,
        })
        .where(eq(emailOutbox.id, input.id));
    },

    // Only rows still pending: one already sent, abandoned or canceled is
    // history, and rewriting it would lose what actually happened to it.
    async cancelPending(input) {
      const canceled = await db
        .update(emailOutbox)
        .set({
          status: "canceled",
          nextAttemptAt: input.at,
          ...clearedMessage,
        })
        .where(
          and(
            eq(emailOutbox.status, "pending"),
            eq(emailOutbox.type, input.type),
            eq(emailOutbox.recipient, input.recipient),
          ),
        )
        .returning({ id: emailOutbox.id });

      return { canceled: canceled.length };
    },

    // One DELETE, no read and no lock that delivery cares about. The due index
    // starts at status, so it narrows both branches, but its second column is
    // next_attempt_at: only the abandoned branch has its time cut by the index,
    // while sent_at is filtered row by row. That is fine at this size, and the
    // sweep is rare, so it does not justify an index of its own.
    async purge(input) {
      const deleted = await db
        .delete(emailOutbox)
        .where(
          or(
            and(
              eq(emailOutbox.status, "sent"),
              lt(emailOutbox.sentAt, input.sentBefore),
            ),
            // Abandoned for whatever reason: all three stamp the transition in
            // next_attempt_at, so one window measures the three of them.
            and(
              inArray(emailOutbox.status, ["failed", "expired", "canceled"]),
              lt(emailOutbox.nextAttemptAt, input.abandonedBefore),
            ),
          ),
        )
        .returning({ id: emailOutbox.id });

      return { deleted: deleted.length };
    },
  };
}
