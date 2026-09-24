import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { makeAppOptions, TEST_ENV } from "../../helpers/app-options.js";

describe("helmet", () => {
  it("sets the default security headers on a response", async () => {
    const app = buildApp(makeAppOptions());

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["strict-transport-security"]).toBeDefined();
    await app.close();
  });

  it("sets the same headers on an error response", async () => {
    const app = buildApp(makeAppOptions());

    const response = await app.inject({ method: "GET", url: "/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    await app.close();
  });

  it("leaves the content security policy out outside production, where the swagger ui lives", async () => {
    const app = buildApp(makeAppOptions());

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.headers["content-security-policy"]).toBeUndefined();
    await app.close();
  });

  it("sends the content security policy in production", async () => {
    const app = buildApp(
      makeAppOptions({
        config: {
          ...TEST_ENV,
          NODE_ENV: "production",
          FRONTEND_ORIGIN: "https://app.example.com",
        },
      }),
    );

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.headers["content-security-policy"]).toBeDefined();
    await app.close();
  });
});
