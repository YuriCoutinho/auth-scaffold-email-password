import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import databasePlugin from "../../src/plugins/database.js";
import { TEST_ENV } from "../helpers/app-options.js";

describe("database plugin", () => {
  it("decorates fastify.db and closes the pool with the app", async () => {
    const app = Fastify();
    await app.register(databasePlugin, { config: TEST_ENV });
    await app.ready();
    expect(app.db).toBeDefined();
    expect(typeof app.db.select).toBe("function");
    // postgres.js connects lazily, so closing without a server must resolve.
    await expect(app.close()).resolves.toBeUndefined();
  });
});
