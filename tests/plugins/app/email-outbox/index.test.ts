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

  it("writes an enqueued message through to the repository", async () => {
    const opts = makeAppOptions();
    const app = buildApp(opts);
    await app.ready();

    await app.emailOutbox.enqueue(message);

    expect(opts.emailOutboxRepository.messages).toHaveLength(1);
    expect(opts.emailOutboxRepository.messages[0]).toMatchObject({
      ...message,
      status: "pending",
    });
    await app.close();
  });

  it("delivers a queued message through the injected sender on one batch", async () => {
    const opts = makeAppOptions();
    const app = buildApp(opts);
    await app.ready();
    await app.emailOutbox.enqueue(message);

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
    await app.emailOutbox.enqueue(message);

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

  it("closes cleanly with the worker enabled", async () => {
    const app = buildApp(makeAppOptions({ startEmailWorker: true }));
    await app.ready();

    await expect(app.close()).resolves.toBeUndefined();
  });
});
