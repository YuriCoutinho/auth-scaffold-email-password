// Three terminal outcomes telling three different stories: the provider
// refused, we took too long, or the message stopped being the current one.
export type OutboxStatus =
  | "pending"
  | "sent"
  | "failed"
  | "expired"
  | "canceled";

export interface OutboxMessage {
  type: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
  // Opaque to the outbox and handed back on give-up, so the domain can tell
  // whether the message that failed still matches the state it wrote.
  correlationId?: string;
  // The deadline of what the message carries, decided by whoever enqueues.
  expiresAt?: Date | null;
}

export interface OutboxRecord
  extends Omit<OutboxMessage, "correlationId" | "expiresAt"> {
  id: number;
  attempts: number;
  correlationId: string | null;
  expiresAt: Date | null;
}

export interface ClaimDueInput {
  now: Date;
  limit: number;
  leaseSeconds: number;
}

export interface RescheduleInput {
  id: number;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string;
}

export interface PurgeInput {
  sentBefore: Date;
  abandonedBefore: Date;
}

export interface GiveUpInput {
  id: number;
  attempts: number;
  lastError: string;
  at: Date;
}

export interface ExpireInput {
  id: number;
  at: Date;
}

export interface CancelPendingInput {
  type: string;
  recipient: string;
  at: Date;
}

export interface EmailOutboxRepository {
  enqueue(message: OutboxMessage): Promise<void>;
  // Claiming leases what it returns by pushing next_attempt_at forward, so a
  // second claim never sees the same row and a worker that dies mid-send
  // leaves a row that becomes due again on its own.
  claimDue(input: ClaimDueInput): Promise<OutboxRecord[]>;
  markSent(id: number, at: Date): Promise<void>;
  reschedule(input: RescheduleInput): Promise<void>;
  // Giving up also clears the rendered message: it will never be sent, so the
  // body would be exposure and nothing else.
  giveUp(input: GiveUpInput): Promise<void>;
  // A deadline that passed is terminal too, and for a different reason than a
  // give-up: nobody refused the message, it simply stopped being worth
  // delivering. The content goes the same way.
  expire(input: ExpireInput): Promise<void>;
  // Generic on purpose: the outbox does not know that a new code invalidates
  // the previous one, only how to drop the rows a caller declares stale.
  cancelPending(input: CancelPendingInput): Promise<{ canceled: number }>;
  // Rows stop existing once they stop being useful, so a delivered code does
  // not outlive its own purpose in the database.
  purge(input: PurgeInput): Promise<{ deleted: number }>;
}
