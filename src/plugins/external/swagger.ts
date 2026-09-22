import swagger, { type FastifyDynamicSwaggerOptions } from "@fastify/swagger";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

export const autoConfig: FastifyDynamicSwaggerOptions = {
  openapi: {
    info: { title: "Auth Scaffold API", version: "0.1.0" },
  },
  transform: jsonSchemaTransform,
};

export default swagger;
