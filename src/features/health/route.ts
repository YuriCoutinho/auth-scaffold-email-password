import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { healthSchema } from "./schema.js";

const route: FastifyPluginAsyncZod = async (app) => {
  app.get("/health", { schema: healthSchema }, async () => ({
    status: "ok" as const,
  }));
};

export default route;
