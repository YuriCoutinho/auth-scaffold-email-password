import { describe, expect, it } from "vitest";
import { createInMemoryEmailOutboxRepository } from "./in-memory-repository.js";

const NOW = new Date("2025-01-01T10:00:00.000Z");

const message = {
  type: "signup_code",
  recipient: "user@example.com",
  subject: "Your verification code: 123456",
  html: "<p>123456</p>",
  text: "123456",
};

describe("claimDue", () => {
  it("returns only pending rows whose next attempt is due", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [
        { ...message, id: 1, nextAttemptAt: NOW },
        {
          ...message,
          id: 2,
          nextAttemptAt: new Date(NOW.getTime() + 60_000),
        },
        { ...message, id: 3, status: "sent", nextAttemptAt: NOW },
      ],
    });

    const claimed = await repo.claimDue({
      now: NOW,
      limit: 10,
      leaseSeconds: 30,
    });

    expect(claimed).toEqual([
      {
        id: 1,
        type: message.type,
        recipient: message.recipient,
        subject: message.subject,
        html: message.html,
        text: message.text,
        correlationId: null,
        attempts: 0,
      },
    ]);
  });

  it("leases what it returns so a second claim in the same window returns nothing", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [{ ...message, id: 1, nextAttemptAt: NOW }],
    });

    const first = await repo.claimDue({
      now: NOW,
      limit: 10,
      leaseSeconds: 30,
    });
    const second = await repo.claimDue({
      now: NOW,
      limit: 10,
      leaseSeconds: 30,
    });

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it("makes a leased row due again once the lease expires", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [{ ...message, id: 1, nextAttemptAt: NOW }],
    });
    await repo.claimDue({ now: NOW, limit: 10, leaseSeconds: 30 });

    const later = new Date(NOW.getTime() + 31_000);

    await expect(
      repo.claimDue({ now: later, limit: 10, leaseSeconds: 30 }),
    ).resolves.toHaveLength(1);
  });

  it("respects the limit", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [
        { ...message, id: 1, nextAttemptAt: NOW },
        { ...message, id: 2, nextAttemptAt: NOW },
        { ...message, id: 3, nextAttemptAt: NOW },
      ],
    });

    const claimed = await repo.claimDue({
      now: NOW,
      limit: 2,
      leaseSeconds: 30,
    });

    expect(claimed.map((row) => row.id)).toEqual([1, 2]);
  });
});

describe("markSent / reschedule / giveUp", () => {
  it("marks a row sent and stamps sentAt", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [{ ...message, id: 1, nextAttemptAt: NOW }],
    });

    await repo.markSent(1, NOW);

    expect(repo.messages[0]).toMatchObject({ status: "sent", sentAt: NOW });
  });

  it("reschedules with the new attempt count and next attempt time", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [{ ...message, id: 1, nextAttemptAt: NOW }],
    });
    const nextAttemptAt = new Date(NOW.getTime() + 10_000);

    await repo.reschedule({
      id: 1,
      attempts: 1,
      nextAttemptAt,
      lastError: "provider unavailable",
    });

    expect(repo.messages[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      nextAttemptAt,
      lastError: "provider unavailable",
    });
  });

  it("clears the rendered message on give-up and keeps the rest of the row", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [{ ...message, id: 1, attempts: 2, nextAttemptAt: NOW }],
    });

    await repo.giveUp({
      id: 1,
      attempts: 3,
      lastError: "provider unavailable",
      at: NOW,
    });

    expect(repo.messages[0]).toMatchObject({
      subject: "",
      html: "",
      text: "",
      type: message.type,
      recipient: message.recipient,
      attempts: 3,
      lastError: "provider unavailable",
    });
  });

  it("gives up by marking the row failed", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [{ ...message, id: 1, nextAttemptAt: NOW }],
    });

    await repo.giveUp({
      id: 1,
      attempts: 3,
      lastError: "provider unavailable",
      at: NOW,
    });

    expect(repo.messages[0]).toMatchObject({
      status: "failed",
      attempts: 3,
      lastError: "provider unavailable",
    });
  });
});

describe("enqueue", () => {
  it("adds a pending row due immediately", async () => {
    const repo = createInMemoryEmailOutboxRepository({ now: () => NOW });

    await repo.enqueue(message);

    expect(repo.messages).toHaveLength(1);
    expect(repo.messages[0]).toMatchObject({
      ...message,
      status: "pending",
      attempts: 0,
      nextAttemptAt: NOW,
      lastError: null,
      sentAt: null,
    });
  });
});

describe("purge", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const windows = {
    sentBefore: new Date(NOW.getTime() - HOUR),
    failedBefore: new Date(NOW.getTime() - 30 * DAY),
  };

  it("deletes a delivered row once its window has passed, and not before", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [
        {
          ...message,
          id: 1,
          status: "sent",
          sentAt: new Date(NOW.getTime() - HOUR - 1),
        },
        {
          ...message,
          id: 2,
          status: "sent",
          sentAt: new Date(NOW.getTime() - HOUR + 1),
        },
      ],
    });

    const { deleted } = await repo.purge(windows);

    expect(deleted).toBe(1);
    expect(repo.messages.map((row) => row.id)).toEqual([2]);
  });

  it("deletes an abandoned row only after the long window", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [
        {
          ...message,
          id: 1,
          status: "failed",
          nextAttemptAt: new Date(NOW.getTime() - 30 * DAY - 1),
        },
        {
          ...message,
          id: 2,
          status: "failed",
          nextAttemptAt: new Date(NOW.getTime() - HOUR),
        },
      ],
    });

    const { deleted } = await repo.purge(windows);

    expect(deleted).toBe(1);
    expect(repo.messages.map((row) => row.id)).toEqual([2]);
  });

  it("never touches a pending row, however old", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [
        {
          ...message,
          id: 1,
          status: "pending",
          nextAttemptAt: new Date(NOW.getTime() - 365 * DAY),
        },
      ],
    });

    const { deleted } = await repo.purge(windows);

    expect(deleted).toBe(0);
    expect(repo.messages).toHaveLength(1);
  });
});
