import type { FastifyPluginAsync, onRequestAsyncHookHandler } from "fastify";
import fp from "fastify-plugin";
import { SESSION_COOKIE } from "../../lib/cookies.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: onRequestAsyncHookHandler;
  }
  interface FastifyRequest {
    user: { id: number } | null;
    session: { id: number } | null;
  }
}

const plugin: FastifyPluginAsync = async (fastify) => {
  // Every request carries the property, so a route that forgets the hook reads
  // null instead of undefined and the type stays honest about it, and because
  // Fastify asks for the request shape to be declared up front instead of being
  // grown per request.
  fastify.decorateRequest("user", null);
  // The hook already resolves the session row to find the user, so it publishes
  // both halves instead of discarding one and making routes derive it again.
  fastify.decorateRequest("session", null);

  fastify.decorate("authenticate", async (request, reply) => {
    const result = await fastify.auth.authenticate(
      request.cookies[SESSION_COOKIE.name],
    );

    if (result.outcome === "invalid") {
      return reply.code(401).send({ message: "Unauthorized." });
    }

    request.user = result.user;
    request.session = result.session;
  });
};

export default fp(plugin, { name: "authenticate", dependencies: ["auth"] });
