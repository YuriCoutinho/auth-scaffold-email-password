import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../app-options.js";
import { createDatabase, type Database } from "../../db/client.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  const database = createDatabase(opts.config.DATABASE_URL);
  fastify.decorate("db", database.db);
  fastify.addHook("onClose", async () => {
    await database.close();
  });
};

export default fp(plugin, { name: "database" });
