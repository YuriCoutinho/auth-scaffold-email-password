import type {
  FastifyPluginAsync,
  FastifyRequest,
  onRequestAsyncHookHandler,
} from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../app-options.js";
import { cookiePolicy } from "../lib/cookies.js";
import { resolveTtl } from "../lib/ttl.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: onRequestAsyncHookHandler;
  }
  interface FastifyRequest {
    user: { id: string } | null;
    session: { id: string } | null;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  const sessionCookie = cookiePolicy(resolveTtl(opts.ttl)).session;

  // Every request carries the property, so a route that forgets the hook reads
  // null instead of undefined and the type stays honest about it, and because
  // Fastify asks for the request shape to be declared up front instead of being
  // grown per request.
  fastify.decorateRequest("user", null);
  // The hook already resolves the session row to find the user, so it publishes
  // both halves instead of discarding one and making routes derive it again.
  fastify.decorateRequest("session", null);

  fastify.decorate("authenticate", async (request, reply) => {
    const result = await fastify.sessions.authenticate(
      request.cookies[sessionCookie.name],
    );

    if (result.outcome === "invalid") {
      return reply.code(401).send({ message: "Unauthorized." });
    }

    request.user = result.user;
    request.session = result.session;
  });
};

export default fp(plugin, { name: "authenticate", dependencies: ["sessions"] });

// The routes declare the hook, so a missing user here means the hook was
// dropped from the route, not that the caller is unauthorized.
export function requireAuth(request: FastifyRequest): {
  userId: string;
  sessionId: string;
} {
  if (!request.user || !request.session) {
    throw new Error("Route reached without the authenticate hook");
  }
  return { userId: request.user.id, sessionId: request.session.id };
}
