import type {
  FastifyInstance,
  FastifyRequest,
  RouteHandlerMethod,
} from "fastify";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { requireAuth } from "../../src/http/authenticate.js";
import { cookiePolicy } from "../../src/lib/cookies.js";
import { hashSessionToken } from "../../src/lib/token-hash.js";
import { DEFAULT_TTL } from "../../src/lib/ttl.js";
import { makeAppOptions } from "../helpers/app-options.js";
import { createInMemoryStore } from "../helpers/in-memory-store.js";

const TOKEN = "a-session-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_COOKIE = cookiePolicy(DEFAULT_TTL).session.name;

function secondsAgo(seconds: number) {
  return new Date(Date.now() - seconds * 1000);
}

function repositoryWithSession(createdAt: Date, expiresAt?: Date) {
  return createInMemoryStore({
    users: [{ id: USER_ID, email: "a@b.com" }],
    sessions: [
      {
        id: SESSION_ID,
        userId: USER_ID,
        tokenHash: hashSessionToken(TOKEN),
        createdAt,
        ...(expiresAt ? { expiresAt } : {}),
      },
    ],
  });
}

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
  it("lets a request with a live session through and exposes the user and session ids", async () => {
    const app = buildApp(
      makeAppOptions({ store: repositoryWithSession(secondsAgo(60)) }),
    );
    const seen = vi.fn();
    protectedRoute(app, "GET", async (request) => {
      seen({ user: request.user, session: request.session });
      return { ok: true };
    });

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: { [SESSION_COOKIE]: TOKEN },
    });

    expect(response.statusCode).toBe(200);
    expect(seen).toHaveBeenCalledWith({
      user: { id: USER_ID },
      session: { id: SESSION_ID },
    });
    await app.close();
  });

  it("leaves both user and session null on a route that skips the hook", async () => {
    const app = buildApp(makeAppOptions());
    const seen = vi.fn();
    app.register(async (instance) => {
      instance.get("/unprotected", async (request) => {
        seen({ user: request.user, session: request.session });
        return { ok: true };
      });
    });

    await app.inject({ method: "GET", url: "/unprotected" });

    expect(seen).toHaveBeenCalledWith({ user: null, session: null });
    await app.close();
  });

  const REFUSALS: Array<{
    name: string;
    cookie?: string;
    createdAt?: Date;
  }> = [
    { name: "the cookie is missing" },
    { name: "the token is unknown", cookie: "not-a-real-token" },
    {
      name: "the session is past its ttl",
      cookie: TOKEN,
      createdAt: secondsAgo(DEFAULT_TTL.sessionSeconds + 60),
    },
  ];

  it.each(REFUSALS)(
    "returns a generic 401 and never clears the session cookie when $name",
    async ({ cookie, createdAt }) => {
      const app = buildApp(
        makeAppOptions({
          store: repositoryWithSession(createdAt ?? secondsAgo(60)),
        }),
      );
      protectedRoute(app, "GET", async () => ({ ok: true }));

      const response = await app.inject({
        method: "GET",
        url: "/protected",
        ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}),
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ message: "Unauthorized." });
      expect(response.headers["set-cookie"]).toBeUndefined();
      await app.close();
    },
  );

  it("refuses a session whose row was deleted, as after a logout", async () => {
    const store = repositoryWithSession(secondsAgo(60));
    await store.legacy.deleteSessionByTokenHash(hashSessionToken(TOKEN));
    const app = buildApp(makeAppOptions({ store }));
    protectedRoute(app, "GET", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: { [SESSION_COOKIE]: TOKEN },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("judges expiry by the stored expiry, whatever ttl buildApp gets", async () => {
    const app = buildApp(
      makeAppOptions({
        store: repositoryWithSession(secondsAgo(120), secondsAgo(60)),
        ttl: { sessionSeconds: 30 * 24 * 60 * 60 },
      }),
    );
    protectedRoute(app, "GET", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: { [SESSION_COOKIE]: TOKEN },
    });

    expect(response.statusCode).toBe(401);
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

describe("requireAuth", () => {
  it("throws when the request carries no user or session", () => {
    const request = { user: null, session: null } as FastifyRequest;
    expect(() => requireAuth(request)).toThrow(
      "Route reached without the authenticate hook",
    );
  });

  it("returns the user id and the session id when both are set", () => {
    const request = {
      user: { id: USER_ID },
      session: { id: SESSION_ID },
    } as FastifyRequest;
    expect(requireAuth(request)).toEqual({
      userId: USER_ID,
      sessionId: SESSION_ID,
    });
  });
});
