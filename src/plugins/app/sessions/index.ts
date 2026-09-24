import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../../app-options.js";
import { resolveTtl } from "../../../lib/ttl.js";
import { createSessions, type Sessions } from "./create-sessions.js";
import { createDrizzleSessionRepository } from "./drizzle-repository.js";

declare module "fastify" {
  interface FastifyInstance {
    sessions: Sessions;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  fastify.decorate(
    "sessions",
    createSessions({
      repository:
        opts.sessionRepository ?? createDrizzleSessionRepository(fastify.db),
      ttl: resolveTtl(opts.ttl),
      log: fastify.log,
    }),
  );
};

export default fp(plugin, { name: "sessions", dependencies: ["database"] });
