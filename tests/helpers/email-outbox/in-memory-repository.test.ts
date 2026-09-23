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
        expiresAt: null,
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

describe("expire", () => {
  it("marks the row expired, clears the message and stamps the transition", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [{ ...message, id: 1, attempts: 1, nextAttemptAt: NOW }],
    });
    const at = new Date(NOW.getTime() + 60_000);

    await repo.expire({ id: 1, at });

    expect(repo.messages[0]).toMatchObject({
      status: "expired",
      subject: "",
      html: "",
      text: "",
      type: message.type,
      recipient: message.recipient,
      attempts: 1,
      nextAttemptAt: at,
    });
  });
});

describe("cancelPending", () => {
  const seed = () =>
    createInMemoryEmailOutboxRepository({
      messages: [
        { ...message, id: 1 },
        { ...message, id: 2 },
        { ...message, id: 3, recipient: "other@example.com" },
        { ...message, id: 4, type: "password_changed" },
        { ...message, id: 5, status: "sent", sentAt: NOW },
        { ...message, id: 6, status: "failed" },
      ],
    });

  it("cancels the pending rows of that type and recipient, clearing the message", async () => {
    const repo = seed();
    const at = new Date(NOW.getTime() + 1_000);

    const { canceled } = await repo.cancelPending({
      type: message.type,
      recipient: message.recipient,
      at,
    });

    expect(canceled).toBe(2);
    expect(repo.messages.slice(0, 2)).toMatchObject([
      {
        id: 1,
        status: "canceled",
        subject: "",
        html: "",
        text: "",
        recipient: message.recipient,
        nextAttemptAt: at,
      },
      { id: 2, status: "canceled", subject: "", html: "", text: "" },
    ]);
  });

  it("never touches another recipient, another type, or a row that is not pending", async () => {
    const repo = seed();

    await repo.cancelPending({
      type: message.type,
      recipient: message.recipient,
      at: NOW,
    });

    expect(repo.messages.slice(2)).toMatchObject([
      { id: 3, status: "pending", subject: message.subject },
      { id: 4, status: "pending", subject: message.subject },
      { id: 5, status: "sent", subject: message.subject },
      { id: 6, status: "failed", subject: message.subject },
    ]);
  });

  it("reports nothing canceled when no pending row matches", async () => {
    const repo = seed();

    await expect(
      repo.cancelPending({
        type: message.type,
        recipient: "nobody@example.com",
        at: NOW,
      }),
    ).resolves.toEqual({ canceled: 0 });
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
      expiresAt: null,
    });
  });

  it("keeps the deadline of whoever enqueued the message", async () => {
    const repo = createInMemoryEmailOutboxRepository({ now: () => NOW });
    const expiresAt = new Date(NOW.getTime() + 900_000);

    await repo.enqueue({ ...message, expiresAt });

    expect(repo.messages[0]?.expiresAt).toEqual(expiresAt);
  });
});

describe("purge", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const windows = {
    sentBefore: new Date(NOW.getTime() - HOUR),
    abandonedBefore: new Date(NOW.getTime() - 30 * DAY),
  };

  it("deletes a delivered row past its cutoff and keeps the one exactly on it", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [
        {
          ...message,
          id: 1,
          status: "sent",
          sentAt: new Date(windows.sentBefore.getTime() - 1),
        },
        // Exactly on the cutoff: the window is "older than", not "as old as",
        // so this row stays and a <= would be caught here.
        {
          ...message,
          id: 2,
          status: "sent",
          sentAt: new Date(windows.sentBefore.getTime()),
        },
        {
          ...message,
          id: 3,
          status: "sent",
          sentAt: new Date(windows.sentBefore.getTime() + 1),
        },
      ],
    });

    const { deleted } = await repo.purge(windows);

    expect(deleted).toBe(1);
    expect(repo.messages.map((row) => row.id)).toEqual([2, 3]);
  });

  it("deletes an abandoned row past its cutoff and keeps the one exactly on it", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [
        {
          ...message,
          id: 1,
          status: "failed",
          nextAttemptAt: new Date(windows.abandonedBefore.getTime() - 1),
        },
        {
          ...message,
          id: 2,
          status: "failed",
          nextAttemptAt: new Date(windows.abandonedBefore.getTime()),
        },
        {
          ...message,
          id: 3,
          status: "failed",
          nextAttemptAt: new Date(windows.abandonedBefore.getTime() + 1),
        },
      ],
    });

    const { deleted } = await repo.purge(windows);

    expect(deleted).toBe(1);
    expect(repo.messages.map((row) => row.id)).toEqual([2, 3]);
  });

  it("measures an expired and a canceled row on the abandoned window too", async () => {
    const old = new Date(windows.abandonedBefore.getTime() - 1);
    const repo = createInMemoryEmailOutboxRepository({
      messages: [
        { ...message, id: 1, status: "expired", nextAttemptAt: old },
        { ...message, id: 2, status: "canceled", nextAttemptAt: old },
        {
          ...message,
          id: 3,
          status: "expired",
          nextAttemptAt: new Date(NOW.getTime() - HOUR),
        },
        {
          ...message,
          id: 4,
          status: "canceled",
          nextAttemptAt: new Date(NOW.getTime() - HOUR),
        },
      ],
    });

    const { deleted } = await repo.purge(windows);

    expect(deleted).toBe(2);
    expect(repo.messages.map((row) => row.id)).toEqual([3, 4]);
  });

  it("applies each window to its own status", async () => {
    const twoHoursAgo = new Date(NOW.getTime() - 2 * HOUR);
    const repo = createInMemoryEmailOutboxRepository({
      messages: [
        // Past the short window, nowhere near the long one.
        { ...message, id: 1, status: "sent", sentAt: twoHoursAgo },
        // Same age, but this status is kept for thirty days.
        { ...message, id: 2, status: "failed", nextAttemptAt: twoHoursAgo },
      ],
    });

    const { deleted } = await repo.purge(windows);

    // Swapping the two windows would invert exactly this result.
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
