import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { makeAppOptions, TEST_ENV } from "../../helpers/app-options.js";

const ORIGIN = "https://app.example.com";

function buildAppWithOrigin() {
  return buildApp(
    makeAppOptions({ config: { ...TEST_ENV, FRONTEND_ORIGIN: ORIGIN } }),
  );
}

describe("cors", () => {
  it("allows the configured origin to send credentials", async () => {
    const app = buildAppWithOrigin();

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: ORIGIN },
    });

    expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    await app.close();
  });

  it("answers the preflight of the configured origin", async () => {
    const app = buildAppWithOrigin();

    const response = await app.inject({
      method: "OPTIONS",
      url: "/auth/login",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

    expect(response.statusCode).toBeLessThan(300);
    expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    await app.close();
  });

  it("does not allow an unknown origin", async () => {
    const app = buildAppWithOrigin();

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example.com" },
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("serves a request that carries no origin at all", async () => {
    const app = buildAppWithOrigin();

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("sends no cors headers when no frontend origin is configured", async () => {
    const app = buildApp(makeAppOptions());

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: ORIGIN },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});
