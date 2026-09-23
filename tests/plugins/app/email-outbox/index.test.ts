import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../../src/app.js";
import type { FakeEmailSender } from "../../../../src/plugins/app/email/drivers/fake.js";
import { makeAppOptions } from "../../../helpers/app-options.js";

const message = {
  type: "signup_code",
  recipient: "user@example.com",
  subject: "Your verification code: 123456",
  html: "<p>123456</p>",
  text: "123456",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("email outbox plugin", () => {
  it("schedules no timer when the worker is disabled", async () => {
    vi.useFakeTimers();
    const app = buildApp(makeAppOptions({ startEmailWorker: false }));
    await app.ready();

    expect(vi.getTimerCount()).toBe(0);

    await app.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("schedules and runs the loop when the worker is enabled", async () => {
    vi.useFakeTimers();
    const opts = makeAppOptions({ startEmailWorker: true });
    const app = buildApp(opts);
    await app.ready();
    await opts.emailOutboxRepository.enqueue(message);

    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(opts.emailOutboxRepository.messages[0]?.status).toBe("sent");
    // The loop rearmed itself instead of running once and stopping.
    expect(vi.getTimerCount()).toBe(1);

    await app.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("delivers a queued message through the injected sender on one batch", async () => {
    const opts = makeAppOptions();
    const app = buildApp(opts);
    await app.ready();
    await opts.emailOutboxRepository.enqueue(message);

    const result = await app.emailOutbox.processBatch();

    expect(result).toMatchObject({ sent: 1 });
    expect((opts.emailSender as FakeEmailSender).sent).toEqual([
      {
        to: message.recipient,
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
    ]);
    expect(opts.emailOutboxRepository.messages[0]?.status).toBe("sent");
    await app.close();
  });

  it("runs the give-up handler registered for a type", async () => {
    const opts = makeAppOptions({
      emailSender: {
        send: vi.fn().mockRejectedValue(new Error("provider unavailable")),
      },
    });
    const app = buildApp(opts);
    await app.ready();
    const onGiveUp = vi.fn().mockResolvedValue(undefined);
    app.emailOutbox.onGiveUp("signup_code", onGiveUp);
    await opts.emailOutboxRepository.enqueue(message);

    // One batch per attempt, until the signup code policy runs out of them.
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const queued of opts.emailOutboxRepository.messages) {
        queued.nextAttemptAt = new Date(0);
      }
      await app.emailOutbox.processBatch();
    }

    expect(opts.emailOutboxRepository.messages[0]?.status).toBe("failed");
    expect(onGiveUp).toHaveBeenCalledExactlyOnceWith(message.recipient, null);
    await app.close();
  });

  it("waits for the batch in flight before closing", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const opts = makeAppOptions({
      startEmailWorker: true,
      emailSender: {
        send: vi.fn().mockImplementation(async () => {
          await held;
          return { providerMessageId: "msg-1" };
        }),
      },
    });
    const app = buildApp(opts);
    await app.ready();
    await opts.emailOutboxRepository.enqueue(message);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(opts.emailSender?.send).toHaveBeenCalledOnce();

    let closed = false;
    const closing = app.close().then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(closed).toBe(false);

    release();
    await closing;

    expect(closed).toBe(true);
    expect(opts.emailOutboxRepository.messages[0]?.status).toBe("sent");
  });

  it("closes cleanly with the worker enabled", async () => {
    const app = buildApp(makeAppOptions({ startEmailWorker: true }));
    await app.ready();

    await expect(app.close()).resolves.toBeUndefined();
  });

  it("never logs the recipient when the batch itself fails", async () => {
    vi.useFakeTimers();
    const logged: unknown[] = [];
    const opts = makeAppOptions({ startEmailWorker: true });
    opts.emailOutboxRepository.claimDue = vi
      .fn()
      .mockRejectedValue(
        new Error("duplicate key value: (recipient)=(user@example.com)"),
      );
    const app = buildApp({
      ...opts,
      logger: {
        level: "error",
        // A stream captures exactly what the logger would write out.
        stream: {
          write: (line: string) => {
            logged.push(line);
          },
        },
      },
    });
    await app.ready();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join("\n")).toContain("email outbox batch failed");
    expect(logged.join("\n")).not.toContain("user@example.com");

    await app.close();
  });
});
