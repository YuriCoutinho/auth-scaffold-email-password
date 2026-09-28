import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../app-options.js";
import type { Executor, Transaction } from "../../db/client.js";
import { createDrizzleCredentialThrottleRepository } from "./drizzle-repository.js";
import {
  type CredentialThrottleService,
  createCredentialThrottleService,
} from "./service.js";

export type CredentialThrottleModule = CredentialThrottleService & {
  inTx(tx: Transaction): CredentialThrottleService;
};

declare module "fastify" {
  interface FastifyInstance {
    credentialThrottle: CredentialThrottleModule;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  const repositoryFor =
    opts.repositories?.credentialThrottle ??
    createDrizzleCredentialThrottleRepository;
  const build = (executor: Executor) =>
    createCredentialThrottleService({
      repo: repositoryFor(executor),
      hmacSecret: opts.config.HMAC_SECRET,
      log: fastify.log,
    });
  fastify.decorate("credentialThrottle", { ...build(fastify.db), inTx: build });
};

export default fp(plugin, {
  name: "credential-throttle",
  dependencies: ["database"],
});
