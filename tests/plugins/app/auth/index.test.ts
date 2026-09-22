import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import authPlugin from "../../../../src/plugins/app/auth/index.js";
import { makeAppOptions } from "../../../helpers/app-options.js";

describe("auth plugin", () => {
  it("decorates fastify.auth built from the app options", async () => {
    const opts = makeAppOptions();
    const app = Fastify();
    await app.register(authPlugin, opts);
    await app.ready();

    expect(typeof app.auth.signup).toBe("function");
    expect(
      (await app.auth.login("nobody@example.com", "x", null)).outcome,
    ).toBe("invalid");
    await app.close();
  });
});
