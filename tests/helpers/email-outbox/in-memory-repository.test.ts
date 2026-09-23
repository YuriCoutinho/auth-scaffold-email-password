import { describe, expect, it } from "vitest";
import { EmailProviderError } from "../../../src/plugins/app/email/sender.js";
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

  it("never stores a provider body in lastError", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [{ ...message, id: 1, nextAttemptAt: NOW }],
    });
    const error = new EmailProviderError("email provider request failed", {
      status: 422,
      body: '{"to":"user@example.com"}',
    });

    await repo.giveUp({
      id: 1,
      attempts: 3,
      lastError: error.message,
      at: NOW,
    });

    expect(repo.messages[0]?.lastError).toBe("email provider request failed");
    expect(repo.messages[0]?.lastError).not.toContain(message.recipient);
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
