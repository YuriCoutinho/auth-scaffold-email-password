import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { AppOptions } from "../../../src/app-options.js";
import type { Executor, Transaction } from "../../../src/db/client.js";
import sessionsPlugin from "../../../src/modules/sessions/index.js";
import type { SessionsRepository } from "../../../src/modules/sessions/repository.js";
import databasePlugin from "../../../src/plugins/database.js";
import { makeAppOptions, TEST_ENV } from "../../helpers/app-options.js";

function fakeRepository(): SessionsRepository {
  return {
    createSession: vi.fn(),
    findSessionByTokenHash: vi.fn(),
    deleteSessionByTokenHash: vi.fn(),
    deleteUserSessions: vi.fn(),
    deleteUserSession: vi.fn(),
    listUserSessions: vi.fn(),
    purgeExpired: vi.fn(),
  };
}

describe("sessions module", () => {
  it("decorates fastify.sessions built from the app options", async () => {
    const opts = makeAppOptions();
    const app = Fastify();
    await app.register(databasePlugin, opts);
    await app.register(sessionsPlugin, opts);
    await app.ready();

    expect(typeof app.sessions.issue).toBe("function");
    expect(typeof app.sessions.authenticate).toBe("function");
    expect(typeof app.sessions.endByToken).toBe("function");
    expect(typeof app.sessions.endAllOfUser).toBe("function");
    expect(typeof app.sessions.endOne).toBe("function");
    expect(typeof app.sessions.listActive).toBe("function");
    expect(typeof app.sessions.purgeExpired).toBe("function");
    expect(typeof app.sessions.inTx).toBe("function");
    await app.close();
  });

  it("builds the Drizzle repository from fastify.db when none is given", async () => {
    const opts: AppOptions = { config: TEST_ENV };
    const app = Fastify();
    await app.register(databasePlugin, opts);
    await app.register(sessionsPlugin, opts);
    await app.ready();

    expect(typeof app.sessions.issue).toBe("function");
    await app.close();
  });

  it("builds the top-level service over fastify.db", async () => {
    const factory = vi.fn().mockImplementation(fakeRepository);
    const opts = makeAppOptions({ repositories: { sessions: factory } });
    const app = Fastify();
    await app.register(databasePlugin, opts);
    await app.register(sessionsPlugin, opts);
    await app.ready();

    expect(factory).toHaveBeenCalledExactlyOnceWith(app.db);

    await app.close();
  });

  it("inTx builds a service over the given executor", async () => {
    const factory = vi.fn().mockImplementation(fakeRepository);
    const opts = makeAppOptions({ repositories: { sessions: factory } });
    const app = Fastify();
    await app.register(databasePlugin, opts);
    await app.register(sessionsPlugin, opts);
    await app.ready();
    factory.mockClear();

    const tx = {} as Transaction;
    const scoped = app.sessions.inTx(tx);

    expect(factory).toHaveBeenCalledExactlyOnceWith(tx as Executor);
    expect(typeof scoped.issue).toBe("function");
    await app.close();
  });
});
