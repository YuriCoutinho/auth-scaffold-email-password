import type { FastifyPluginAsync, onRequestAsyncHookHandler } from "fastify";
import fp from "fastify-plugin";
import { SESSION_COOKIE } from "../../lib/cookies.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: onRequestAsyncHookHandler;
  }
  interface FastifyRequest {
    user: { id: number } | null;
  }
}

const plugin: FastifyPluginAsync = async (fastify) => {
  // Every request carries the property, so a route that forgets the hook reads
  // null instead of undefined and the type stays honest about it.
  fastify.decorateRequest("user", null);

  fastify.decorate("authenticate", async (request, reply) => {
    const result = await fastify.auth.authenticate(
      request.cookies[SESSION_COOKIE.name],
    );

    if (result.outcome === "invalid") {
      return reply.code(401).send({ message: "Unauthorized." });
    }

    request.user = result.user;
  });
};

export default fp(plugin, { name: "authenticate", dependencies: ["auth"] });
