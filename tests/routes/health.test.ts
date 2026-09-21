import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { makeAppDeps } from "../helpers/app-deps.js";

describe("GET /health", () => {
  it("responds 200 with status ok", async () => {
    const app = buildApp(makeAppDeps());
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
