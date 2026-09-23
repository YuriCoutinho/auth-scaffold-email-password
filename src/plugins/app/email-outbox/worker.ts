import type { FastifyBaseLogger } from "fastify";
import { EmailProviderError, type EmailSender } from "../email/sender.js";
import type { EmailOutboxRepository } from "./repository.js";

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
          await deps.repo.markSent(row.id, now());
          sent += 1;
          deps.log?.info(
            { outboxId: row.id, type: row.type },
            "outbox email sent",
          );
        } catch (error) {
          const attempts = row.attempts + 1;
          const policy = deps.policyFor(row.type);
          const lastError =
            error instanceof Error ? error.message : "unknown error";

          if (attempts >= policy.maxAttempts) {
            await deps.repo.giveUp({
              id: row.id,
              attempts,
              lastError,
              at: now(),
            });
            gaveUp += 1;
            deps.log?.error(
              {
                outboxId: row.id,
                type: row.type,
                attempts,
                ...describe(error),
              },
              "outbox email given up on",
            );
            await runGiveUpHandler(row.type, row.recipient);
            continue;
          }

          await deps.repo.reschedule({
            id: row.id,
            attempts,
            nextAttemptAt: new Date(
              now().getTime() + policy.backoffSeconds(attempts) * 1000,
            ),
            lastError,
          });
          rescheduled += 1;
          deps.log?.warn(
            { outboxId: row.id, type: row.type, attempts, ...describe(error) },
            "outbox email delivery failed, retrying",
          );
        }
      }

      return { sent, rescheduled, gaveUp };
    },
  };
}

export type EmailOutboxWorker = ReturnType<typeof createEmailOutboxWorker>;
