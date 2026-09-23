import type {
  EmailOutboxRepository,
  OutboxMessage,
  OutboxStatus,
} from "../../../src/plugins/app/email-outbox/repository.js";

export interface StoredOutboxMessage
  extends Omit<OutboxMessage, "correlationId"> {
  id: number;
  correlationId: string | null;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

export interface InMemoryOutboxSeed {
  messages?: Array<Partial<StoredOutboxMessage>>;
  now?: () => Date;
}

// Mirrors the lease semantics of the Drizzle adapter, because it is what every
// other test runs against.
export function createInMemoryEmailOutboxRepository(
  seed: InMemoryOutboxSeed = {},
) {
  const now = seed.now ?? (() => new Date());
  const messages: StoredOutboxMessage[] = [];
  let nextId = 1;

  const store = (
    message: Partial<StoredOutboxMessage> & { correlationId?: string | null },
  ) => {
    const id = message.id ?? nextId;
    nextId = Math.max(nextId, id + 1);
    const createdAt = message.createdAt ?? now();
    messages.push({
      id,
      type: message.type ?? "signup_code",
      recipient: message.recipient ?? "user@example.com",
      subject: message.subject ?? "subject",
      html: message.html ?? "<p>body</p>",
      text: message.text ?? "body",
      correlationId: message.correlationId ?? null,
      status: message.status ?? "pending",
      attempts: message.attempts ?? 0,
      nextAttemptAt: message.nextAttemptAt ?? createdAt,
      lastError: message.lastError ?? null,
      createdAt,
      sentAt: message.sentAt ?? null,
    });
  };

  for (const message of seed.messages ?? []) {
    store(message);
  }

  const find = (id: number) => messages.find((message) => message.id === id);

  const repository: EmailOutboxRepository = {
    async enqueue(message) {
      store(message);
    },

    async claimDue(input) {
      const due = messages
        .filter(
          (message) =>
            message.status === "pending" &&
            message.nextAttemptAt.getTime() <= input.now.getTime(),
        )
        .sort(
          (a, b) =>
            a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() ||
            a.id - b.id,
        )
        .slice(0, input.limit);

      const leaseUntil = new Date(
        input.now.getTime() + input.leaseSeconds * 1000,
      );
      for (const message of due) {
        message.nextAttemptAt = leaseUntil;
      }

      return due.map((message) => ({
        id: message.id,
        type: message.type,
        recipient: message.recipient,
        subject: message.subject,
        html: message.html,
        text: message.text,
        correlationId: message.correlationId,
        attempts: message.attempts,
      }));
    },

    async markSent(id, at) {
      const message = find(id);
      if (message) {
        message.status = "sent";
        message.sentAt = at;
      }
    },

    async reschedule(input) {
      const message = find(input.id);
      if (message) {
        message.attempts = input.attempts;
        message.nextAttemptAt = input.nextAttemptAt;
        message.lastError = input.lastError;
      }
    },

    async giveUp(input) {
      const message = find(input.id);
      if (message) {
        message.status = "failed";
        message.attempts = input.attempts;
        message.lastError = input.lastError;
        message.nextAttemptAt = input.at;
        message.subject = "";
        message.html = "";
        message.text = "";
      }
    },

    async purge(input) {
      const kept = messages.filter(
        (message) =>
          !(
            (message.status === "sent" &&
              message.sentAt !== null &&
              message.sentAt.getTime() < input.sentBefore.getTime()) ||
            (message.status === "failed" &&
              message.nextAttemptAt.getTime() < input.failedBefore.getTime())
          ),
      );
      const deleted = messages.length - kept.length;
      messages.splice(0, messages.length, ...kept);
      return { deleted };
    },
  };

  return { ...repository, messages };
}

export type InMemoryEmailOutboxRepository = ReturnType<
  typeof createInMemoryEmailOutboxRepository
>;
