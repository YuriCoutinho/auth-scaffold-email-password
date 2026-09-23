import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../../src/app.js";
import type { AppOptions } from "../../../../src/app-options.js";
import authPlugin from "../../../../src/plugins/app/auth/index.js";
import databasePlugin from "../../../../src/plugins/app/database.js";
import emailSenderPlugin from "../../../../src/plugins/app/email/index.js";
import emailOutboxPlugin from "../../../../src/plugins/app/email-outbox/index.js";
import pwnedPasswordPlugin from "../../../../src/plugins/app/pwned-password/index.js";
import { makeAppOptions, TEST_ENV } from "../../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../../helpers/auth/in-memory-repository.js";

describe("auth plugin", () => {
  it("decorates fastify.auth built from the app options", async () => {
    const opts = makeAppOptions();
    const app = Fastify();
    await app.register(databasePlugin, opts);
    await app.register(emailSenderPlugin, opts);
    await app.register(emailOutboxPlugin, opts);
    await app.register(pwnedPasswordPlugin, opts);
    await app.register(authPlugin, opts);
    await app.ready();

    expect(typeof app.auth.signup).toBe("function");
    expect(
      (await app.auth.login("nobody@example.com", "x", null)).outcome,
    ).toBe("invalid");
    await app.close();
  });

  it("builds the Drizzle repository from fastify.db when none is given", async () => {
    const opts: AppOptions = { config: TEST_ENV };
    const app = Fastify();
    await app.register(databasePlugin, opts);
    await app.register(emailSenderPlugin, opts);
    await app.register(emailOutboxPlugin, opts);
    await app.register(pwnedPasswordPlugin, opts);
    await app.register(authPlugin, opts);
    await app.ready();

    expect(typeof app.auth.signup).toBe("function");
    await app.close();
  });
});

describe("signup code give-up compensation", () => {
  const PENDING = {
    email: "user@example.com",
    signupSessionToken: "token-1",
    codeHash: "code-hash-a",
    codeSendCount: 1,
    expiresAt: new Date(Date.now() + 900_000),
  };

  async function buildWithDeadProvider(pending: Partial<typeof PENDING> = {}) {
    const authRepository = createInMemoryAuthRepository({
      pendingSignups: [{ ...PENDING, ...pending }],
    });
    const emailSender = {
      send: vi.fn().mockRejectedValue(new Error("provider down")),
    };
    const opts = makeAppOptions({ authRepository, emailSender });
    const app = buildApp(opts);
    await app.ready();
    return { app, opts, authRepository, emailSender };
  }

  // Every attempt of the policy, without waiting out the backoff.
  async function exhaustAttempts(
    app: Awaited<ReturnType<typeof buildWithDeadProvider>>["app"],
    opts: Awaited<ReturnType<typeof buildWithDeadProvider>>["opts"],
    attempts: number,
  ) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      for (const queued of opts.emailOutboxRepository.messages) {
        queued.nextAttemptAt = new Date(0);
      }
      await app.emailOutbox.processBatch();
    }
  }

  const signupCodeMessage = (correlationId: string) => ({
    type: "signup_code",
    recipient: PENDING.email,
    correlationId,
    subject: "Your verification code: 123456",
    html: "<p>123456</p>",
    text: "123456",
  });

  it("frees the resend quota when the current signup code is given up on", async () => {
    const { app, opts, authRepository } = await buildWithDeadProvider();
    await opts.emailOutboxRepository.enqueue(signupCodeMessage("code-hash-a"));

    await exhaustAttempts(app, opts, 3);

    expect(opts.emailOutboxRepository.messages[0]?.status).toBe("failed");
    expect(
      authRepository.pendingSignups.get(PENDING.email)?.codeSendCount,
    ).toBe(0);
    await app.close();
  });

  it("leaves the quota alone when the given-up code was already replaced by a delivered one", async () => {
    const { app, opts, authRepository } = await buildWithDeadProvider({
      codeHash: "code-hash-b",
      codeSendCount: 2,
    });
    await opts.emailOutboxRepository.enqueue(signupCodeMessage("code-hash-a"));

    await exhaustAttempts(app, opts, 3);

    expect(opts.emailOutboxRepository.messages[0]?.status).toBe("failed");
    expect(
      authRepository.pendingSignups.get(PENDING.email)?.codeSendCount,
    ).toBe(2);
    await app.close();
  });

  it("frees the resend quota when the code passed its deadline undelivered", async () => {
    const { app, opts, authRepository } = await buildWithDeadProvider();
    await opts.emailOutboxRepository.enqueue({
      ...signupCodeMessage("code-hash-a"),
      expiresAt: new Date(Date.now() - 1),
    });

    await app.emailOutbox.processBatch();

    expect(opts.emailOutboxRepository.messages[0]?.status).toBe("expired");
    expect(
      authRepository.pendingSignups.get(PENDING.email)?.codeSendCount,
    ).toBe(0);
    await app.close();
  });

  it("never claims a canceled row nor compensates for it", async () => {
    const { app, opts, authRepository, emailSender } =
      await buildWithDeadProvider();
    await opts.emailOutboxRepository.enqueue(signupCodeMessage("code-hash-a"));
    await opts.emailOutboxRepository.cancelPending({
      type: "signup_code",
      recipient: PENDING.email,
      at: new Date(),
    });

    await app.emailOutbox.processBatch();

    expect(emailSender.send).not.toHaveBeenCalled();
    expect(opts.emailOutboxRepository.messages[0]?.status).toBe("canceled");
    // The user asked for the code that replaced this one, so the send was
    // consumed serving them and the quota is not given back.
    expect(
      authRepository.pendingSignups.get(PENDING.email)?.codeSendCount,
    ).toBe(1);
    await app.close();
  });

  it("leaves the pending signup alone when a password notice is given up on", async () => {
    const { app, opts, authRepository } = await buildWithDeadProvider();
    await opts.emailOutboxRepository.enqueue({
      type: "password_changed",
      recipient: PENDING.email,
      subject: "Your password was changed",
      html: "<p>changed</p>",
      text: "changed",
    });

    await exhaustAttempts(app, opts, 5);

    expect(opts.emailOutboxRepository.messages[0]?.status).toBe("failed");
    expect(
      authRepository.pendingSignups.get(PENDING.email)?.codeSendCount,
    ).toBe(1);
    await app.close();
  });
});
