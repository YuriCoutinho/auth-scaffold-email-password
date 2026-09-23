import type { FastifyPluginAsync, onRequestAsyncHookHandler } from "fastify";
import fp from "fastify-plugin";
import { SESSION_COOKIE } from "../../lib/cookies.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: onRequestAsyncHookHandler;
  }
  interface FastifyRequest {
    user: { id: number };
  }
}

const plugin: FastifyPluginAsync = async (fastify) => {
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
