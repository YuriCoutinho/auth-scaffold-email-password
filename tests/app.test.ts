import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { makeAppOptions } from "./helpers/app-options.js";

describe("openapi", () => {
  it("documents POST /auth/signup request and responses", async () => {
    const app = buildApp(makeAppOptions());
    await app.ready();
    const spec = app.swagger();
    const operation = spec.paths?.["/auth/signup"]?.post;
    expect(operation).toBeDefined();
    expect(operation?.responses).toHaveProperty("202");
    expect(operation?.responses).toHaveProperty("400");
    await app.close();
  });

  it("serves the docs UI only when enabled", async () => {
    const enabled = buildApp(makeAppOptions({ enableDocsUi: true }));
    const disabled = buildApp(makeAppOptions({ enableDocsUi: false }));
    expect(
      (await enabled.inject({ method: "GET", url: "/docs" })).statusCode,
    ).not.toBe(404);
    expect(
      (await disabled.inject({ method: "GET", url: "/docs" })).statusCode,
    ).toBe(404);
    await enabled.close();
    await disabled.close();
  });
});
