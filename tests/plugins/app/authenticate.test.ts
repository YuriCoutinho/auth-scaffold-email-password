import type { FastifyInstance, RouteHandlerMethod } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashSessionToken } from "../../../src/lib/token-hash.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/auth/in-memory-repository.js";

const TOKEN = "a-session-token";

// The route has to be registered after the app plugin, so that the hook
// decorator already exists when the route options are built.
function protectedRoute(
  app: FastifyInstance,
  method: "GET" | "POST",
  handler: RouteHandlerMethod,
) {
  app.register(async (instance) => {
    instance.route({
      method,
      url: "/protected",
      onRequest: [instance.authenticate],
      handler,
    });
  });
}

describe("authenticate hook", () => {
  it("lets a request with an active session through and exposes the user id", async () => {
    const authRepository = createInMemoryAuthRepository({
      authUsers: [{ id: 7, email: "a@b.com" }],
      sessions: [
        {
          userId: 7,
          tokenHash: hashSessionToken(TOKEN),
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });
    const app = buildApp(makeAppOptions({ authRepository }));
    const seen = vi.fn();
    protectedRoute(app, "GET", async (request) => {
      seen(request.user);
      return { ok: true };
    });

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(200);
    expect(seen).toHaveBeenCalledWith({ id: 7 });
    await app.close();
  });

  it("returns a generic 401 when the cookie is missing", async () => {
    const app = buildApp(makeAppOptions());
    protectedRoute(app, "GET", async () => ({ ok: true }));

    const response = await app.inject({ method: "GET", url: "/protected" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
    await app.close();
  });

  it("returns the same generic 401 for an unknown token", async () => {
    const app = buildApp(makeAppOptions());
    protectedRoute(app, "GET", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: { session: "not-a-real-token" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Unauthorized." });
    await app.close();
  });

  it("never clears the session cookie when it refuses a request", async () => {
    const authRepository = createInMemoryAuthRepository({
      authUsers: [{ id: 7, email: "a@b.com" }],
      sessions: [
        {
          userId: 7,
          tokenHash: hashSessionToken(TOKEN),
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: new Date(),
        },
      ],
    });
    const app = buildApp(makeAppOptions({ authRepository }));
    protectedRoute(app, "GET", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: { session: TOKEN },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });

  it("rejects before parsing the body of an unauthenticated request", async () => {
    const app = buildApp(makeAppOptions());
    const handler = vi.fn();
    protectedRoute(app, "POST", async () => {
      handler();
      return { ok: true };
    });

    const response = await app.inject({
      method: "POST",
      url: "/protected",
      headers: { "content-type": "application/json" },
      payload: "{ this is not valid json",
    });

    expect(response.statusCode).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    await app.close();
  });
});
