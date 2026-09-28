import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { AppOptions } from "../../../src/app-options.js";
import type { Executor, Transaction } from "../../../src/db/client.js";
import credentialThrottlePlugin from "../../../src/modules/credential-throttle/index.js";
import type { CredentialThrottleRepository } from "../../../src/modules/credential-throttle/repository.js";
import databasePlugin from "../../../src/plugins/database.js";
import { makeAppOptions, TEST_ENV } from "../../helpers/app-options.js";

function fakeRepository(): CredentialThrottleRepository {
  return {
    findThrottleByKeyHash: vi.fn(),
    upsertThrottleFailure: vi.fn(),
    clearThrottle: vi.fn(),
    purgeStale: vi.fn(),
  };
}

describe("credential-throttle module", () => {
  it("decorates fastify.credentialThrottle built from the app options", async () => {
    const opts = makeAppOptions();
    const app = Fastify();
    await app.register(databasePlugin, opts);
    await app.register(credentialThrottlePlugin, opts);
    await app.ready();

    expect(typeof app.credentialThrottle.check).toBe("function");
    expect(typeof app.credentialThrottle.registerFailure).toBe("function");
    expect(typeof app.credentialThrottle.reset).toBe("function");
    expect(typeof app.credentialThrottle.purgeStale).toBe("function");
    expect(typeof app.credentialThrottle.inTx).toBe("function");
    await expect(
      app.credentialThrottle.check("foo@gmail.com"),
    ).resolves.toEqual({ outcome: "allowed" });
    await app.close();
  });

  it("builds the Drizzle repository from fastify.db when none is given", async () => {
    const opts: AppOptions = { config: TEST_ENV };
    const app = Fastify();
    await app.register(databasePlugin, opts);
    await app.register(credentialThrottlePlugin, opts);
    await app.ready();

    expect(typeof app.credentialThrottle.check).toBe("function");
    await app.close();
  });

  it("builds the top-level service over fastify.db", async () => {
    const factory = vi.fn().mockImplementation(fakeRepository);
    const opts = makeAppOptions({
      repositories: { credentialThrottle: factory },
    });
    const app = Fastify();
    await app.register(databasePlugin, opts);
    await app.register(credentialThrottlePlugin, opts);
    await app.ready();

    expect(factory).toHaveBeenCalledExactlyOnceWith(app.db);

    await app.close();
  });

  it("inTx builds a service over the given executor", async () => {
    const factory = vi.fn().mockImplementation(fakeRepository);
    const opts = makeAppOptions({
      repositories: { credentialThrottle: factory },
    });
    const app = Fastify();
    await app.register(databasePlugin, opts);
    await app.register(credentialThrottlePlugin, opts);
    await app.ready();
    factory.mockClear();

    const tx = {} as Transaction;
    const scoped = app.credentialThrottle.inTx(tx);

    expect(factory).toHaveBeenCalledExactlyOnceWith(tx as Executor);
    expect(typeof scoped.check).toBe("function");
    await app.close();
  });
});
