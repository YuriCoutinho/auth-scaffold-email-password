import swaggerUi from "@fastify/swagger-ui";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../app-options.js";

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  if (opts.config.NODE_ENV === "production") {
    return;
  }
  await fastify.register(swaggerUi, { routePrefix: "/docs" });
};

export default fp(plugin, {
  name: "swagger-ui",
  dependencies: ["swagger"],
});
