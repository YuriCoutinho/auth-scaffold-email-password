import { describe, expect, it, vi } from "vitest";
import { FakeEmailSender } from "../../../../src/plugins/app/email/drivers/fake.js";
import { EmailProviderError } from "../../../../src/plugins/app/email/sender.js";
import {
  createEmailOutboxWorker,
  defaultPolicyFor,
  FAILED_RETENTION_SECONDS,
  PURGE_INTERVAL_SECONDS,
  SENT_RETENTION_SECONDS,
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

const BODY_TOKEN = "trace-9f3c1d";

const providerError = () =>
  new EmailProviderError("resend responded 500", {
    status: 500,
    body: `to=${RECIPIENT} trace=${BODY_TOKEN}`,
  });

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
    const log = makeLog();
    const worker = createEmailOutboxWorker({
      repo: spied,
      emailSender: new FakeEmailSender(),
      policyFor: defaultPolicyFor,
      onGiveUp,
      log,
      now: () => NOW,
    });

    const result = await worker.processBatch();

    expect(result).toEqual({ sent: 1, rescheduled: 0, gaveUp: 0 });
    expect(spied.reschedule).not.toHaveBeenCalled();
    expect(spied.giveUp).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
    // One record for the row, not a success and a failure side by side.
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledOnce();
    expect(log.error.mock.calls[0]?.[1]).toBe(
      "outbox email sent but not marked, it will be sent again",
    );
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

  it("keeps only the error message in lastError, never the provider body", async () => {
    const emailSender = { send: vi.fn().mockRejectedValue(providerError()) };
    const { repo, worker } = makeWorker({ emailSender });

    await worker.processBatch();

    expect(repo.messages[0]?.lastError).toBe("resend responded 500");
  });

  it("never logs the recipient address, the provider body or the error message", async () => {
    const error = providerError();
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
    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain(RECIPIENT);
    // A token of the provider body that survives JSON escaping intact.
    expect(serialized).not.toContain(BODY_TOKEN);
    expect(serialized).not.toContain(error.message);
    // What does reach the log, so the assertions above are not vacuous.
    expect(serialized).toContain("providerStatus");
    expect(serialized).toContain("outbox email delivery failed, retrying");
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

describe("retention", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it("purges delivered and abandoned rows past their windows, and nothing else", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [
        {
          ...message,
          id: 1,
          status: "sent",
          sentAt: new Date(NOW.getTime() - HOUR - 1_000),
        },
        {
          ...message,
          id: 2,
          status: "sent",
          sentAt: new Date(NOW.getTime() - 60_000),
        },
        {
          ...message,
          id: 3,
          status: "failed",
          nextAttemptAt: new Date(NOW.getTime() - 30 * DAY - 1_000),
        },
        {
          ...message,
          id: 4,
          status: "failed",
          nextAttemptAt: new Date(NOW.getTime() - 29 * DAY),
        },
        {
          ...message,
          id: 5,
          status: "pending",
          nextAttemptAt: new Date(NOW.getTime() - 365 * DAY),
        },
      ],
    });
    const worker = createEmailOutboxWorker({
      repo,
      emailSender: new FakeEmailSender(),
      policyFor: defaultPolicyFor,
      now: () => NOW,
    });

    await worker.processBatch();

    // Row 5 was due, so it was delivered by this very batch, not purged.
    expect(repo.messages.map((row) => row.id)).toEqual([2, 4, 5]);
  });

  it("keeps the retention windows and the sweep pace explicit", () => {
    // Policy numbers, like the list of revocation reasons: changing one is a
    // decision, not a refactor, so the value itself is pinned here.
    expect(SENT_RETENTION_SECONDS).toBe(60 * 60);
    expect(FAILED_RETENTION_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(PURGE_INTERVAL_SECONDS).toBe(5 * 60);
  });

  it("measures each window from the retention it declares", async () => {
    const purge = vi.fn().mockResolvedValue({ deleted: 0 });
    const { repo } = makeWorker({}, []);
    const worker = createEmailOutboxWorker({
      repo: { ...repo, purge },
      emailSender: new FakeEmailSender(),
      policyFor: defaultPolicyFor,
      now: () => NOW,
    });

    await worker.processBatch();

    expect(purge).toHaveBeenCalledWith({
      sentBefore: new Date(NOW.getTime() - SENT_RETENTION_SECONDS * 1000),
      failedBefore: new Date(NOW.getTime() - FAILED_RETENTION_SECONDS * 1000),
    });
  });

  it("sweeps once per interval instead of once per cycle", async () => {
    const purge = vi.fn().mockResolvedValue({ deleted: 0 });
    const { repo } = makeWorker({}, []);
    let clock = NOW;
    const worker = createEmailOutboxWorker({
      repo: { ...repo, purge },
      emailSender: new FakeEmailSender(),
      policyFor: defaultPolicyFor,
      now: () => clock,
    });

    await worker.processBatch();
    await worker.processBatch();
    expect(purge).toHaveBeenCalledOnce();

    clock = new Date(NOW.getTime() + PURGE_INTERVAL_SECONDS * 1000 - 1);
    await worker.processBatch();
    expect(purge).toHaveBeenCalledOnce();

    clock = new Date(NOW.getTime() + PURGE_INTERVAL_SECONDS * 1000);
    await worker.processBatch();
    expect(purge).toHaveBeenCalledTimes(2);
  });

  it("logs how many rows went away, and says nothing when none did", async () => {
    const { repo } = makeWorker({}, []);
    const log = makeLog();
    const build = (deleted: number) =>
      createEmailOutboxWorker({
        repo: { ...repo, purge: vi.fn().mockResolvedValue({ deleted }) },
        emailSender: new FakeEmailSender(),
        policyFor: defaultPolicyFor,
        log,
        now: () => NOW,
      });

    await build(0).processBatch();
    expect(log.info).not.toHaveBeenCalled();

    await build(3).processBatch();
    expect(log.info).toHaveBeenCalledExactlyOnceWith(
      { deleted: 3 },
      "outbox rows purged",
    );
  });

  it("delivers the batch even when the purge fails", async () => {
    const repo = createInMemoryEmailOutboxRepository({
      messages: [{ ...message, id: 1, nextAttemptAt: NOW }],
    });
    const log = makeLog();
    const worker = createEmailOutboxWorker({
      repo: {
        ...repo,
        purge: vi.fn().mockRejectedValue(new Error("connection closed")),
      },
      emailSender: new FakeEmailSender(),
      policyFor: defaultPolicyFor,
      log,
      now: () => NOW,
    });

    await expect(worker.processBatch()).resolves.toEqual({
      sent: 1,
      rescheduled: 0,
      gaveUp: 0,
    });
    expect(repo.messages[0]?.status).toBe("sent");
    expect(log.error).toHaveBeenCalledOnce();
    expect(log.error.mock.calls[0]?.[1]).toBe("outbox purge failed");
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
