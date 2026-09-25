import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../../app-options.js";
import { RETENTION_INTERVAL_SECONDS } from "../../../lib/retention.js";
import { createRetention, type Retention } from "./create-retention.js";
import { createDrizzleRetentionRepository } from "./drizzle-repository.js";

declare module "fastify" {
  interface FastifyInstance {
    retention: Retention;
  }
}

// Every instance runs its own timer: the sweep is a set of idempotent
// deletes, so overlapping runs cost a little work and need no coordination.
const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  const retention = createRetention({
    repository:
      opts.retentionRepository ?? createDrizzleRetentionRepository(fastify.db),
    log: fastify.log,
  });
  fastify.decorate("retention", retention);

  // unref: a pending sweep must never be what keeps the process alive.
  const timer = setInterval(() => {
    void retention.sweep();
  }, RETENTION_INTERVAL_SECONDS * 1000).unref();
  fastify.addHook("onClose", async () => {
    clearInterval(timer);
  });
};

export default fp(plugin, { name: "retention", dependencies: ["database"] });
