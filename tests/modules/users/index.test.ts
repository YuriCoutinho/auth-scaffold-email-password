import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { AppOptions } from "../../../src/app-options.js";
import type { Executor, Transaction } from "../../../src/db/client.js";
import usersPlugin from "../../../src/modules/users/index.js";
import type { UsersRepository } from "../../../src/modules/users/repository.js";
import database from "../../../src/plugins/database.js";
import email from "../../../src/plugins/email/index.js";
import { makeAppOptions, TEST_ENV } from "../../helpers/app-options.js";

function fakeRepository(): UsersRepository {
  return {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    upsertUnverified: vi.fn(),
    markVerified: vi.fn(),
    setPasswordHash: vi.fn(),
    purgeAbandonedUnverified: vi.fn(),
  };
}

describe("users module", () => {
  it("decorates fastify.users built from the app options", async () => {
    const opts = makeAppOptions();
    const app = Fastify();
    await app.register(database, opts);
    await app.register(email, opts);
    await app.register(usersPlugin, opts);
    await app.ready();

    expect(typeof app.users.findByEmail).toBe("function");
    expect(typeof app.users.findById).toBe("function");
    expect(typeof app.users.upsertUnverified).toBe("function");
    expect(typeof app.users.markVerified).toBe("function");
    expect(typeof app.users.setPasswordHash).toBe("function");
    expect(typeof app.users.purgeAbandonedUnverified).toBe("function");
    expect(typeof app.users.publicProfile).toBe("function");
    expect(typeof app.users.notifyPasswordChanged).toBe("function");
    expect(typeof app.users.inTx).toBe("function");
    await app.close();
  });

  it("builds the Drizzle repository from fastify.db when none is given", async () => {
    const opts: AppOptions = { config: TEST_ENV };
    const app = Fastify();
    await app.register(database, opts);
    await app.register(email, opts);
    await app.register(usersPlugin, opts);
    await app.ready();

    expect(typeof app.users.findByEmail).toBe("function");
    await app.close();
  });

  it("builds the top-level service over fastify.db", async () => {
    const factory = vi.fn().mockImplementation(fakeRepository);
    const opts = makeAppOptions({ repositories: { users: factory } });
    const app = Fastify();
    await app.register(database, opts);
    await app.register(email, opts);
    await app.register(usersPlugin, opts);
    await app.ready();

    expect(factory).toHaveBeenCalledExactlyOnceWith(app.db);

    await app.close();
  });

  it("inTx builds a service over the given executor", async () => {
    const factory = vi.fn().mockImplementation(fakeRepository);
    const opts = makeAppOptions({ repositories: { users: factory } });
    const app = Fastify();
    await app.register(database, opts);
    await app.register(email, opts);
    await app.register(usersPlugin, opts);
    await app.ready();
    factory.mockClear();

    const tx = {} as Transaction;
    const scoped = app.users.inTx(tx);

    expect(factory).toHaveBeenCalledExactlyOnceWith(tx as Executor);
    expect(typeof scoped.findByEmail).toBe("function");
    await app.close();
  });
});
