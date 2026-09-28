import helmet from "@fastify/helmet";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { Env } from "../../config/env.js";

const plugin: FastifyPluginAsync<{ config: Env }> = async (fastify, opts) => {
  // The Swagger UI only exists outside production, and its inline script and
  // style do not survive the default policy. Relaxing a whole directive there
  // beats hand-writing directives that would then also ship to production.
  await fastify.register(helmet, {
    ...(opts.config.NODE_ENV === "production"
      ? {}
      : { contentSecurityPolicy: false }),
  });
};

export default fp(plugin, { name: "helmet" });
