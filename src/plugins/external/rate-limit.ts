import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../app-options.js";
import { rateLimitFor } from "../../lib/rate-limit.js";

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  // The default in-memory store is the right one here: a counter per instance
  // is disposable state, and writing it to Postgres would be one write per
  // attempt, including the attempts about to be rejected.
  await fastify.register(rateLimit, {
    global: true,
    ...rateLimitFor("global", opts.rateLimit),
  });

  fastify.setNotFoundHandler(
    { preHandler: fastify.rateLimit() },
    (_request, reply) => reply.code(404).send({ message: "Not Found." }),
  );
};

export default fp(plugin, { name: "rate-limit" });
