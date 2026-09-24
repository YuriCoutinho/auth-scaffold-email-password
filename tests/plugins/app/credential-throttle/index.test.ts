import { describe, expect, it } from "vitest";
import { buildApp } from "../../../../src/app.js";
import { makeAppOptions } from "../../../helpers/app-options.js";

describe("credential-throttle plugin", () => {
  it("decorates the instance and allows an unknown key", async () => {
    const app = buildApp(makeAppOptions());
    await app.ready();
    await expect(
      app.credentialThrottle.check("foo@gmail.com"),
    ).resolves.toEqual({ outcome: "allowed" });
    await app.close();
  });
});
