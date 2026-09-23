import { describe, expect, it, vi } from "vitest";
import { FakeEmailSender } from "../../../../src/plugins/app/email/drivers/fake.js";
import { EmailProviderError } from "../../../../src/plugins/app/email/sender.js";
import {
  createEmailOutboxWorker,
  defaultPolicyFor,
} from "../../../../src/plugins/app/email-outbox/worker.js";
import { createInMemoryEmailOutboxRepository } from "../../../helpers/email-outbox/in-memory-repository.js";

const NOW = new Date("2025-01-01T10:00:00.000Z");
const RECIPIENT = "user@example.com";

const message = {
  type: "signup_code",
  recipient: RECIPIENT,
  subject: "Your verification code: 123456",
  html: "<p>123456</p>",
  text: "123456",
};

function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeWorker(
  overrides: Partial<Parameters<typeof createEmailOutboxWorker>[0]> = {},
  seed = [message],
) {
  const repo = createInMemoryEmailOutboxRepository({
    messages: seed.map((seeded, position) => ({
      ...seeded,
      id: position + 1,
      nextAttemptAt: NOW,
    })),
  });
  const emailSender = new FakeEmailSender();
  const worker = createEmailOutboxWorker({
    repo,
    emailSender,
    policyFor: defaultPolicyFor,
    now: () => NOW,
    ...overrides,
  });
  return { repo, emailSender, worker };
}

describe("processBatch", () => {
  it("sends every claimed row and marks it sent", async () => {
    const { repo, emailSender, worker } = makeWorker({}, [
      message,
      { ...message, recipient: "other@example.com" },
    ]);

    const result = await worker.processBatch();

    expect(result).toEqual({ sent: 2, rescheduled: 0, gaveUp: 0 });
    expect(emailSender.sent).toEqual([
      {
        to: RECIPIENT,
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
      {
        to: "other@example.com",
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
    ]);
    expect(repo.messages.map((row) => row.status)).toEqual(["sent", "sent"]);
    expect(repo.messages[0]?.sentAt).toEqual(NOW);
  });

  it("reschedules with an incremented attempt count and the policy backoff when the provider throws", async () => {
    const emailSender = {
      send: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };
    const { repo, worker } = makeWorker({ emailSender });

    const result = await worker.processBatch();

    expect(result).toEqual({ sent: 0, rescheduled: 1, gaveUp: 0 });
    expect(repo.messages[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      nextAttemptAt: new Date(NOW.getTime() + 10_000),
      lastError: "provider unavailable",
    });
  });

  it("gives up and marks the row failed once the attempts reach the cap", async () => {
    const emailSender = {
      send: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };
    const { repo, worker } = makeWorker({ emailSender }, []);
    repo.messages.push({
      ...message,
      id: 1,
      status: "pending",
      attempts: 2,
      nextAttemptAt: NOW,
      lastError: "provider unavailable",
      correlationId: null,
      createdAt: NOW,
      sentAt: null,
    });

    const result = await worker.processBatch();

    expect(result).toEqual({ sent: 0, rescheduled: 0, gaveUp: 1 });
    expect(repo.messages[0]).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("calls onGiveUp with the type, recipient and correlation exactly once on give-up", async () => {
    const emailSender = {
      send: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };
    const onGiveUp = vi.fn().mockResolvedValue(undefined);
    const { repo, worker } = makeWorker({ emailSender, onGiveUp }, []);
    repo.messages.push({
      ...message,
      id: 1,
      status: "pending",
      attempts: 2,
      nextAttemptAt: NOW,
      lastError: null,
      correlationId: "code-hash",
      createdAt: NOW,
      sentAt: null,
    });

    await worker.processBatch();

    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith(message.type, RECIPIENT, "code-hash");
  });

  it("never calls onGiveUp on a reschedule", async () => {
    const emailSender = {
      send: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };
    const onGiveUp = vi.fn().mockResolvedValue(undefined);
    const { worker } = makeWorker({ emailSender, onGiveUp });

    await worker.processBatch();

    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("keeps processing the rest of the batch when one message throws", async () => {
    const emailSender = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error("provider unavailable"))
        .mockResolvedValue({ providerMessageId: "id-2" }),
    };
    const { repo, worker } = makeWorker({ emailSender }, [
      message,
      { ...message, recipient: "other@example.com" },
    ]);

    const result = await worker.processBatch();

    expect(result).toEqual({ sent: 1, rescheduled: 1, gaveUp: 0 });
    expect(repo.messages.map((row) => row.status)).toEqual(["pending", "sent"]);
  });

  it("does not treat a failed mark as a failed delivery", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [{ ...message, id: 1, nextAttemptAt: NOW }],
    });
    const spied = {
      ...repo,
      markSent: vi.fn().mockRejectedValue(new Error("connection closed")),
      reschedule: vi.fn(),
      giveUp: vi.fn(),
    };
    const onGiveUp = vi.fn();
    const worker = createEmailOutboxWorker({
      repo: spied,
      emailSender: new FakeEmailSender(),
      policyFor: defaultPolicyFor,
      onGiveUp,
      now: () => NOW,
    });

    const result = await worker.processBatch();

    expect(result).toEqual({ sent: 1, rescheduled: 0, gaveUp: 0 });
    expect(spied.reschedule).not.toHaveBeenCalled();
    expect(spied.giveUp).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("keeps processing the batch when the reschedule write fails", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [
        { ...message, id: 1, nextAttemptAt: NOW },
        { ...message, id: 2, nextAttemptAt: NOW },
      ],
    });
    const spied = {
      ...repo,
      reschedule: vi.fn().mockRejectedValue(new Error("connection closed")),
    };
    const emailSender = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error("provider unavailable"))
        .mockResolvedValue({ providerMessageId: "id-2" }),
    };
    const worker = createEmailOutboxWorker({
      repo: spied,
      emailSender,
      policyFor: defaultPolicyFor,
      now: () => NOW,
    });

    const result = await worker.processBatch();

    expect(result).toEqual({ sent: 1, rescheduled: 0, gaveUp: 0 });
    expect(emailSender.send).toHaveBeenCalledTimes(2);
    expect(repo.messages[1]?.status).toBe("sent");
  });

  it("does not compensate when the give-up write fails", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [{ ...message, id: 1, attempts: 2, nextAttemptAt: NOW }],
    });
    const spied = {
      ...repo,
      giveUp: vi.fn().mockRejectedValue(new Error("connection closed")),
    };
    const onGiveUp = vi.fn();
    const worker = createEmailOutboxWorker({
      repo: spied,
      emailSender: {
        send: vi.fn().mockRejectedValue(new Error("provider unavailable")),
      },
      policyFor: defaultPolicyFor,
      onGiveUp,
      now: () => NOW,
    });

    const result = await worker.processBatch();

    expect(result).toEqual({ sent: 0, rescheduled: 0, gaveUp: 0 });
    expect(onGiveUp).not.toHaveBeenCalled();
    expect(repo.messages[0]?.status).toBe("pending");
  });

  it("never logs the recipient address or the provider body", async () => {
    const error = new EmailProviderError("resend responded 500", {
      status: 500,
      body: `{"to":"${RECIPIENT}"}`,
    });
    const emailSender = { send: vi.fn().mockRejectedValue(error) };
    const log = makeLog();
    const { worker } = makeWorker({ emailSender, log });

    await worker.processBatch();

    const logged = [
      ...log.info.mock.calls,
      ...log.warn.mock.calls,
      ...log.error.mock.calls,
    ];
    expect(logged.length).toBeGreaterThan(0);
    for (const [payload, messageText] of logged) {
      const serialized = JSON.stringify({ payload, messageText });
      expect(serialized).not.toContain(RECIPIENT);
      expect(serialized).not.toContain(error.body);
      expect(Object.values(payload as Record<string, unknown>)).not.toContain(
        error.message,
      );
    }
  });

  it("works without a logger", async () => {
    const { repo, worker } = makeWorker();

    await expect(worker.processBatch()).resolves.toEqual({
      sent: 1,
      rescheduled: 0,
      gaveUp: 0,
    });
    expect(repo.messages[0]?.status).toBe("sent");
  });

  it("returns zero counts and touches nothing when the batch is empty", async () => {
    const emailSender = { send: vi.fn() };
    const { worker } = makeWorker({ emailSender }, []);

    await expect(worker.processBatch()).resolves.toEqual({
      sent: 0,
      rescheduled: 0,
      gaveUp: 0,
    });
    expect(emailSender.send).not.toHaveBeenCalled();
  });
});

describe("defaultPolicyFor", () => {
  it("retries a signup code fewer times than a password notice, because the code expires", () => {
    expect(defaultPolicyFor("signup_code").maxAttempts).toBe(3);
    expect(defaultPolicyFor("password_changed").maxAttempts).toBe(5);
    expect(defaultPolicyFor("signup_code").backoffSeconds(1)).toBe(10);
    expect(defaultPolicyFor("signup_code").backoffSeconds(2)).toBe(30);
    expect(defaultPolicyFor("password_changed").backoffSeconds(4)).toBe(1800);
  });
});
