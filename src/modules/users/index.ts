import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../app-options.js";
import type { Executor, Transaction } from "../../db/client.js";
import { createDrizzleUsersRepository } from "./drizzle-repository.js";
import { createUsersService, type UsersService } from "./service.js";

export type UsersModule = UsersService & {
  inTx(tx: Transaction): UsersService;
};

declare module "fastify" {
  interface FastifyInstance {
    users: UsersModule;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  const repositoryFor =
    opts.repositories?.users ?? createDrizzleUsersRepository;
  const build = (executor: Executor) =>
    createUsersService({
      repo: repositoryFor(executor),
      emailSender: fastify.emailSender,
      log: fastify.log,
    });
  fastify.decorate("users", { ...build(fastify.db), inTx: build });
};

export default fp(plugin, {
  name: "users",
  dependencies: ["database", "email-sender"],
});
