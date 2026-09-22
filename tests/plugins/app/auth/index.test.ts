import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { AppOptions } from "../../../../src/app-options.js";
import authPlugin from "../../../../src/plugins/app/auth/index.js";
import databasePlugin from "../../../../src/plugins/app/database.js";
import emailSenderPlugin from "../../../../src/plugins/app/email/index.js";
import pwnedPasswordPlugin from "../../../../src/plugins/app/pwned-password/index.js";
import { makeAppOptions, TEST_ENV } from "../../../helpers/app-options.js";

describe("auth plugin", () => {
  it("decorates fastify.auth built from the app options", async () => {
    const opts = makeAppOptions();
    const app = Fastify();
    await app.register(databasePlugin, opts);
    await app.register(emailSenderPlugin, opts);
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
    await app.register(pwnedPasswordPlugin, opts);
    await app.register(authPlugin, opts);
    await app.ready();

    expect(typeof app.auth.signup).toBe("function");
    await app.close();
  });
});
