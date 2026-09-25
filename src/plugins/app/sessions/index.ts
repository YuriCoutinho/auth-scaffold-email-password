import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../../app-options.js";
import { createSessions, type Sessions } from "./create-sessions.js";
import { createDrizzleSessionRepository } from "./drizzle-repository.js";

declare module "fastify" {
  interface FastifyInstance {
    legacySessions: Sessions;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  fastify.decorate(
    "legacySessions",
    createSessions({
      repository:
        opts.sessionRepository ?? createDrizzleSessionRepository(fastify.db),
      log: fastify.log,
    }),
  );
};

export default fp(plugin, {
  name: "legacy-sessions",
  dependencies: ["database"],
});
