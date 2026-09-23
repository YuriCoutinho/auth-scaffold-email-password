import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../../app-options.js";
import { createDrizzleEmailOutboxRepository } from "./drizzle-repository.js";
import { createEmailOutboxWorker, defaultPolicyFor } from "./worker.js";

const POLL_INTERVAL_MS = 1_000;

export type GiveUpHandler = (
  recipient: string,
  correlationId: string | null,
) => Promise<void>;

// Enqueuing is deliberately absent: a message has to be written in the same
// transaction as the domain write that caused it, which only a repository
// holding that transaction can do. A decorator built on fastify.db would be a
// non-transactional way in, and the whole point of this slice is that no such
// way exists.
export interface EmailOutbox {
  processBatch(): Promise<{
    sent: number;
    rescheduled: number;
    gaveUp: number;
    expired: number;
  }>;
  // A domain registers what to compensate when a type is given up on, which is
  // how the outbox stays free of any knowledge about that domain.
  onGiveUp(type: string, handler: GiveUpHandler): void;
}

declare module "fastify" {
  interface FastifyInstance {
    emailOutbox: EmailOutbox;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  const repository =
    opts.emailOutboxRepository ??
    createDrizzleEmailOutboxRepository(fastify.db);
  const giveUpHandlers = new Map<string, GiveUpHandler>();

  const worker = createEmailOutboxWorker({
    repo: repository,
    emailSender: fastify.emailSender,
    policyFor: defaultPolicyFor,
    onGiveUp: async (type, recipient, correlationId) => {
      await giveUpHandlers.get(type)?.(recipient, correlationId);
    },
    log: fastify.log,
  });

  fastify.decorate("emailOutbox", {
    processBatch: () => worker.processBatch(),
    onGiveUp: (type, handler) => {
      giveUpHandlers.set(type, handler);
    },
  } satisfies EmailOutbox);

  // A polling loop under the test runner holds the event loop open and leaks
  // across suites, so it stays off unless something asks for it.
  const started = opts.startEmailWorker ?? opts.config.NODE_ENV !== "test";
  if (!started) {
    return;
  }

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<unknown> = Promise.resolve();

  // A self-rescheduling timeout instead of an interval, so a slow batch never
  // overlaps itself, and unref so a pending poll never keeps the process alive.
  const schedule = () => {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      inFlight = worker
        .processBatch()
        .catch((error: unknown) => {
          // Only the error class reaches the log. A database error message can
          // quote column values, and one of those columns is the recipient.
          fastify.log.error(
            { errorName: error instanceof Error ? error.name : "unknown" },
            "email outbox batch failed",
          );
        })
        .finally(schedule);
    }, POLL_INTERVAL_MS);
    timer.unref();
  };

  schedule();

  // Awaiting the batch in flight keeps shutdown from racing the pool teardown.
  fastify.addHook("onClose", async () => {
    stopped = true;
    clearTimeout(timer);
    await inFlight;
  });
};

export default fp(plugin, {
  name: "email-outbox",
  dependencies: ["database", "email-sender"],
});
