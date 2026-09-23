import type { FastifyBaseLogger } from "fastify";
import { EmailProviderError, type EmailSender } from "../email/sender.js";
import type { EmailOutboxRepository, OutboxRecord } from "./repository.js";

export interface RetryPolicy {
  maxAttempts: number;
  backoffSeconds: (attempt: number) => number;
}

export interface EmailOutboxWorkerDeps {
  repo: EmailOutboxRepository;
  emailSender: EmailSender;
  policyFor: (type: string) => RetryPolicy;
  onGiveUp?: (type: string, recipient: string) => Promise<void>;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
  batchSize?: number;
  leaseSeconds?: number;
}

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_LEASE_SECONDS = 60;

// One entry per retry, in seconds, so the number of attempts is the length of
// the schedule plus the first try. A confirmation code dies with the pending
// signup it belongs to, so retrying it for long enough to outlive the code
// would deliver something already useless; a password change notice has no
// deadline and is worth chasing across a longer outage.
const RETRY_SCHEDULES: Record<string, number[]> = {
  signup_code: [10, 30],
  password_changed: [30, 120, 600, 1800],
};

const FALLBACK_SCHEDULE = [30, 120, 600];

export function defaultPolicyFor(type: string): RetryPolicy {
  const schedule = RETRY_SCHEDULES[type] ?? FALLBACK_SCHEDULE;
  return {
    maxAttempts: schedule.length + 1,
    backoffSeconds: (attempt) =>
      schedule[attempt - 1] ?? (schedule.at(-1) as number),
  };
}

export function createEmailOutboxWorker(deps: EmailOutboxWorkerDeps) {
  const now = deps.now ?? (() => new Date());
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const leaseSeconds = deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS;

  // Only the status and the type reach the log: an error message can carry the
  // recipient address, and a provider error can carry a response body echoing
  // it. The message itself is kept in the row, not in the log.
  const describe = (error: unknown) =>
    error instanceof EmailProviderError && error.status !== undefined
      ? { providerStatus: error.status }
      : {};

  // The compensation is best-effort: a handler that throws must not abort the
  // rest of the batch, which would leave sendable rows leased and untouched.
  const runGiveUpHandler = async (type: string, recipient: string) => {
    if (!deps.onGiveUp) {
      return;
    }
    try {
      await deps.onGiveUp(type, recipient);
    } catch (error) {
      deps.log?.error(
        { type, ...describe(error) },
        "outbox give-up handler failed",
      );
    }
  };

  // Both writes are guarded: one row whose bookkeeping fails must not abort
  // the batch, which would leave every remaining row leased and untouched
  // until its lease expires.
  const handleFailure = async (
    row: OutboxRecord,
    error: unknown,
  ): Promise<"rescheduled" | "gave-up" | "unhandled"> => {
    const attempts = row.attempts + 1;
    const policy = deps.policyFor(row.type);
    const lastError = error instanceof Error ? error.message : "unknown error";
    const context = { outboxId: row.id, type: row.type, attempts };

    if (attempts >= policy.maxAttempts) {
      try {
        await deps.repo.giveUp({ id: row.id, attempts, lastError, at: now() });
      } catch (writeError) {
        // The row was not marked failed, so it will be retried. Compensating
        // now would act on a message the queue has not given up on.
        deps.log?.error(
          { ...context, ...describe(writeError) },
          "outbox give-up write failed",
        );
        return "unhandled";
      }
      deps.log?.error(
        { ...context, ...describe(error) },
        "outbox email given up on",
      );
      await runGiveUpHandler(row.type, row.recipient);
      return "gave-up";
    }

    try {
      await deps.repo.reschedule({
        id: row.id,
        attempts,
        nextAttemptAt: new Date(
          now().getTime() + policy.backoffSeconds(attempts) * 1000,
        ),
        lastError,
      });
    } catch (writeError) {
      deps.log?.error(
        { ...context, ...describe(writeError) },
        "outbox reschedule write failed",
      );
      return "unhandled";
    }
    deps.log?.warn(
      { ...context, ...describe(error) },
      "outbox email delivery failed, retrying",
    );
    return "rescheduled";
  };

  return {
    async processBatch(): Promise<{
      sent: number;
      rescheduled: number;
      gaveUp: number;
    }> {
      const claimed = await deps.repo.claimDue({
        now: now(),
        limit: batchSize,
        leaseSeconds,
      });

      let sent = 0;
      let rescheduled = 0;
      let gaveUp = 0;

      for (const row of claimed) {
        try {
          await deps.emailSender.send({
            to: row.recipient,
            subject: row.subject,
            html: row.html,
            text: row.text,
          });
        } catch (error) {
          const outcome = await handleFailure(row, error);
          if (outcome === "rescheduled") {
            rescheduled += 1;
          }
          if (outcome === "gave-up") {
            gaveUp += 1;
          }
          continue;
        }

        // The mark gets its own handling: the provider already accepted the
        // message, so a failure here is not a delivery failure and must not
        // reschedule anything, let alone give up on a message that was sent.
        // The row keeps its lease and the next pass marks it, at the cost of
        // one duplicate send, which is the at-least-once trade this queue makes.
        try {
          await deps.repo.markSent(row.id, now());
        } catch (error) {
          deps.log?.error(
            { outboxId: row.id, type: row.type, ...describe(error) },
            "outbox email sent but not marked",
          );
        }
        sent += 1;
        deps.log?.info(
          { outboxId: row.id, type: row.type },
          "outbox email sent",
        );
      }

      return { sent, rescheduled, gaveUp };
    },
  };
}

export type EmailOutboxWorker = ReturnType<typeof createEmailOutboxWorker>;
