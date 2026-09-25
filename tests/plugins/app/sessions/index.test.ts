import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { AppOptions } from "../../../../src/app-options.js";
import sessionsPlugin from "../../../../src/plugins/app/sessions/index.js";
import databasePlugin from "../../../../src/plugins/database.js";
import { makeAppOptions, TEST_ENV } from "../../../helpers/app-options.js";

describe("legacy sessions plugin", () => {
  it("decorates fastify.legacySessions built from the app options", async () => {
    const opts = makeAppOptions();
    const app = Fastify();
    await app.register(databasePlugin, opts);
    await app.register(sessionsPlugin, opts);
    await app.ready();

    expect(typeof app.legacySessions.logout).toBe("function");
    expect(typeof app.legacySessions.logoutAll).toBe("function");
    expect(typeof app.legacySessions.listSessions).toBe("function");
    await app.close();
  });

  it("builds the Drizzle repository from fastify.db when none is given", async () => {
    const opts: AppOptions = { config: TEST_ENV };
    const app = Fastify();
    await app.register(databasePlugin, opts);
    await app.register(sessionsPlugin, opts);
    await app.ready();

    expect(typeof app.legacySessions.logout).toBe("function");
    await app.close();
  });
});
