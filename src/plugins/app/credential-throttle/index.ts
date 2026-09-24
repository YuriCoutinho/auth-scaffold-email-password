import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../../app-options.js";
import {
  type CredentialThrottle,
  createCredentialThrottle,
} from "./create-credential-throttle.js";
import { createDrizzleCredentialThrottleRepository } from "./drizzle-repository.js";

declare module "fastify" {
  interface FastifyInstance {
    credentialThrottle: CredentialThrottle;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  fastify.decorate(
    "credentialThrottle",
    createCredentialThrottle({
      repository:
        opts.credentialThrottleRepository ??
        createDrizzleCredentialThrottleRepository(fastify.db),
      log: fastify.log,
    }),
  );
};

export default fp(plugin, {
  name: "credential-throttle",
  dependencies: ["database"],
});
