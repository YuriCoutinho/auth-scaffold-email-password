import cors from "@fastify/cors";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { Env } from "../../config/env.js";

const plugin: FastifyPluginAsync<{ config: Env }> = async (fastify, opts) => {
  const origin = opts.config.FRONTEND_ORIGIN;
  if (!origin) {
    return;
  }

  // The origin goes in as a list because a bare string makes the plugin echo it
  // on every response, even one for a request that carries no Origin at all,
  // while a list is matched against the request and also sets Vary: Origin.
  // The session travels in an httpOnly cookie, which the browser only attaches
  // to a cross-origin request when the response allows credentials.
  await fastify.register(cors, { origin: [origin], credentials: true });
};

export default fp(plugin, { name: "cors" });
