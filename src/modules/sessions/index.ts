import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../app-options.js";
import type { Executor, Transaction } from "../../db/client.js";
import { resolveTtl } from "../../lib/ttl.js";
import { createDrizzleSessionsRepository } from "./drizzle-repository.js";
import { createSessionsService, type SessionsService } from "./service.js";

export type SessionsModule = SessionsService & {
  inTx(tx: Transaction): SessionsService;
};

declare module "fastify" {
  interface FastifyInstance {
    sessions: SessionsModule;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  const repositoryFor =
    opts.repositories?.sessions ?? createDrizzleSessionsRepository;
  const ttl = resolveTtl(opts.ttl);
  const build = (executor: Executor) =>
    createSessionsService({ repo: repositoryFor(executor), ttl });
  fastify.decorate("sessions", { ...build(fastify.db), inTx: build });
};

export default fp(plugin, { name: "sessions", dependencies: ["database"] });
