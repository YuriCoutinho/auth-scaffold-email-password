import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { makeAppOptions } from "../helpers/app-options.js";

function buildAppWithFailingRoutes() {
  const app = buildApp(makeAppOptions());
  app.get("/boom", async () => {
    throw new Error("connection to database failed: password=secret");
  });
  app.get("/teapot", async () => {
    throw Object.assign(new Error("I'm a teapot"), { statusCode: 418 });
  });
  return app;
}

describe("error handler", () => {
  it("hides the message of unexpected errors behind a generic 500", async () => {
    const app = buildAppWithFailingRoutes();
    const response = await app.inject({ method: "GET", url: "/boom" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ message: "Internal Server Error" });
    expect(response.body).not.toContain("secret");
    await app.close();
  });

  it("keeps status and message of errors below 500", async () => {
    const app = buildAppWithFailingRoutes();
    const response = await app.inject({ method: "GET", url: "/teapot" });
    expect(response.statusCode).toBe(418);
    expect(response.json()).toEqual({ message: "I'm a teapot" });
    await app.close();
  });

  it("answers schema validation failures with 400 and a message", async () => {
    const app = buildAppWithFailingRoutes();
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "not-an-email", password: "x" },
    });
    expect(response.statusCode).toBe(400);
    expect(typeof response.json().message).toBe("string");
    await app.close();
  });
});
