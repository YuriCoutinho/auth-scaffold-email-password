import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RETENTION_INTERVAL_SECONDS } from "../../../../src/lib/retention.js";
import databasePlugin from "../../../../src/plugins/app/database.js";
import retentionPlugin from "../../../../src/plugins/app/retention/index.js";
import { makeAppOptions } from "../../../helpers/app-options.js";

afterEach(() => {
  vi.useRealTimers();
});

async function buildWithRetention() {
  const purge = vi.fn().mockResolvedValue({
    sessions: 0,
    verificationCodes: 0,
    unverifiedUsers: 0,
    throttleTrails: 0,
  });
  const opts = makeAppOptions({ retentionRepository: { purge } });
  const app = Fastify();
  await app.register(databasePlugin, opts);
  await app.register(retentionPlugin, opts);
  await app.ready();
  return { app, purge };
}

describe("retention plugin", () => {
  it("decorates fastify.retention over the injected repository", async () => {
    const { app, purge } = await buildWithRetention();

    await app.retention.sweep();

    expect(purge).toHaveBeenCalledOnce();
    await app.close();
  });

  it("sweeps on every interval and stops once the app closes", async () => {
    vi.useFakeTimers();
    const { app, purge } = await buildWithRetention();

    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_SECONDS * 1000);
    expect(purge).toHaveBeenCalledOnce();

    await app.close();
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_SECONDS * 1000 * 3);
    expect(purge).toHaveBeenCalledOnce();
  });
});
