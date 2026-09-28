import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../src/db/client.js";
import { RETENTION_INTERVAL_SECONDS } from "../../../src/features/retention-sweep/cutoffs.js";
import retentionJob from "../../../src/features/retention-sweep/job.js";
import credentialThrottleModule from "../../../src/modules/credential-throttle/index.js";
import otpModule from "../../../src/modules/otp/index.js";
import sessionsModule from "../../../src/modules/sessions/index.js";
import usersModule from "../../../src/modules/users/index.js";
import databasePlugin from "../../../src/plugins/database.js";
import emailPlugin from "../../../src/plugins/email/index.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryStore } from "../../helpers/in-memory-store.js";

afterEach(() => {
  vi.useRealTimers();
});

// The store's repository factories ignore the executor they are handed, so
// any value satisfying the type stands in for a real connection.
const db = {} as Executor;

async function buildWithRetention() {
  const store = createInMemoryStore();
  const purgeExpired = vi.spyOn(
    store.repositories.sessions(db),
    "purgeExpired",
  );
  const opts = makeAppOptions({ store });
  const app = Fastify();
  await app.register(databasePlugin, opts);
  await app.register(emailPlugin, opts);
  await app.register(sessionsModule, opts);
  await app.register(usersModule, opts);
  await app.register(credentialThrottleModule, opts);
  await app.register(otpModule, opts);
  await app.register(retentionJob, opts);
  await app.ready();
  return { app, purgeExpired };
}

describe("retention plugin", () => {
  it("decorates fastify.retention over the registered modules", async () => {
    const { app } = await buildWithRetention();

    await expect(app.retention.sweep()).resolves.toEqual({
      sessions: 0,
      verificationCodes: 0,
      unverifiedUsers: 0,
      throttleTrails: 0,
    });
    await app.close();
  });

  it("sweeps on every interval and stops once the app closes", async () => {
    vi.useFakeTimers();
    const { app, purgeExpired } = await buildWithRetention();

    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_SECONDS * 1000);
    expect(purgeExpired).toHaveBeenCalledOnce();

    await app.close();
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_SECONDS * 1000 * 3);
    expect(purgeExpired).toHaveBeenCalledOnce();
  });
});
