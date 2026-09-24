import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { makeAppOptions } from "../../helpers/app-options.js";

describe("rate limit", () => {
  it("returns 429 in the project's error shape once the route limit is spent", async () => {
    const app = buildApp(
      makeAppOptions({
        rateLimit: { login: { max: 1, timeWindow: "1 minute" } },
      }),
    );
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "foo@gmail.com", password: "a-very-long-password" },
      });

    await attempt();
    const response = await attempt();

    expect(response.statusCode).toBe(429);
    expect(Object.keys(response.json())).toEqual(["message"]);
    expect(response.headers["retry-after"]).toBeDefined();
    await app.close();
  });

  it("limits unknown routes too, so route scanning does not escape it", async () => {
    const app = buildApp(
      makeAppOptions({
        rateLimit: { global: { max: 1, timeWindow: "1 minute" } },
      }),
    );
    const first = await app.inject({ method: "GET", url: "/nope" });
    const second = await app.inject({ method: "GET", url: "/nope" });

    expect(first.statusCode).toBe(404);
    expect(first.json()).toEqual({ message: "Not Found." });
    expect(second.statusCode).toBe(429);
    await app.close();
  });

  it("leaves a 204 response without a body", async () => {
    const app = buildApp(makeAppOptions());
    const response = await app.inject({
      method: "DELETE",
      url: "/sessions/current",
    });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    await app.close();
  });
});
