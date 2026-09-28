import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { AppOptions } from "../../../src/app-options.js";
import type { Executor, Transaction } from "../../../src/db/client.js";
import otpPlugin from "../../../src/modules/otp/index.js";
import type { OtpRepository } from "../../../src/modules/otp/repository.js";
import database from "../../../src/plugins/database.js";
import email from "../../../src/plugins/email/index.js";
import { makeAppOptions, TEST_ENV } from "../../helpers/app-options.js";

function fakeRepository(): OtpRepository {
  return {
    find: vi.fn(),
    findByTokenHash: vi.fn(),
    save: vi.fn(),
    rotateToken: vi.fn(),
    restore: vi.fn(),
    incrementAttempts: vi.fn(),
    consume: vi.fn(),
    purgeExpired: vi.fn(),
  };
}

describe("otp module", () => {
  it("decorates fastify.otp built from the app options", async () => {
    const opts = makeAppOptions();
    const app = Fastify();
    await app.register(database, opts);
    await app.register(email, opts);
    await app.register(otpPlugin, opts);
    await app.ready();

    expect(typeof app.otp.issue).toBe("function");
    expect(typeof app.otp.dispatch).toBe("function");
    expect(typeof app.otp.resend).toBe("function");
    expect(typeof app.otp.verify).toBe("function");
    expect(typeof app.otp.consume).toBe("function");
    expect(typeof app.otp.purgeExpired).toBe("function");
    expect(typeof app.otp.inTx).toBe("function");
    await app.close();
  });

  it("builds the Drizzle repository from fastify.db when none is given", async () => {
    const opts: AppOptions = { config: TEST_ENV };
    const app = Fastify();
    await app.register(database, opts);
    await app.register(email, opts);
    await app.register(otpPlugin, opts);
    await app.ready();

    expect(typeof app.otp.issue).toBe("function");
    await app.close();
  });

  it("builds the top-level service over fastify.db", async () => {
    const factory = vi.fn().mockImplementation(fakeRepository);
    const opts = makeAppOptions({ repositories: { otp: factory } });
    const app = Fastify();
    await app.register(database, opts);
    await app.register(email, opts);
    await app.register(otpPlugin, opts);
    await app.ready();

    expect(factory).toHaveBeenCalledExactlyOnceWith(app.db);

    await app.close();
  });

  it("inTx builds a service over the given executor, without dispatch", async () => {
    const factory = vi.fn().mockImplementation(fakeRepository);
    const opts = makeAppOptions({ repositories: { otp: factory } });
    const app = Fastify();
    await app.register(database, opts);
    await app.register(email, opts);
    await app.register(otpPlugin, opts);
    await app.ready();
    factory.mockClear();

    const tx = {} as Transaction;
    const scoped = app.otp.inTx(tx);

    expect(factory).toHaveBeenCalledExactlyOnceWith(tx as Executor);
    expect(typeof scoped.issue).toBe("function");
    expect("dispatch" in scoped).toBe(false);
    await app.close();
  });
});
