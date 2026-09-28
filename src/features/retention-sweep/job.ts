import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../app-options.js";
import { RETENTION_INTERVAL_SECONDS } from "./cutoffs.js";
import { createRetentionSweep } from "./use-case.js";

export interface Retention {
  sweep: ReturnType<typeof createRetentionSweep>;
}

declare module "fastify" {
  interface FastifyInstance {
    retention: Retention;
  }
}

// Every instance runs its own timer: the sweep is a set of idempotent
// deletes, so overlapping runs cost a little work and need no coordination.
const plugin: FastifyPluginAsync<AppOptions> = async (fastify) => {
  const sweep = createRetentionSweep({
    sessions: fastify.sessions,
    otp: fastify.otp,
    users: fastify.users,
    credentialThrottle: fastify.credentialThrottle,
    log: fastify.log,
  });
  fastify.decorate("retention", { sweep });

  // unref: a pending sweep must never be what keeps the process alive.
  const timer = setInterval(() => {
    void sweep();
  }, RETENTION_INTERVAL_SECONDS * 1000).unref();
  fastify.addHook("onClose", async () => {
    clearInterval(timer);
  });
};

export default fp(plugin, {
  name: "retention",
  dependencies: ["sessions", "users", "otp", "credential-throttle"],
});
