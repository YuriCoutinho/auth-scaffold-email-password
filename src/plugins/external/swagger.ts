import swagger from "@fastify/swagger";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

const plugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(swagger, {
    openapi: { info: { title: "Auth Scaffold API", version: "0.1.0" } },
    transform: jsonSchemaTransform,
  });
};

export default fp(plugin, { name: "swagger" });
