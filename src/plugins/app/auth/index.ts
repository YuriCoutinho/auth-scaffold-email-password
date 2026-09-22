import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../../app-options.js";
import { type Auth, createAuth } from "./create-auth.js";
import { createDrizzleAuthRepository } from "./drizzle-repository.js";

declare module "fastify" {
  interface FastifyInstance {
    auth: Auth;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  fastify.decorate(
    "auth",
    createAuth({
      repository:
        opts.authRepository ?? createDrizzleAuthRepository(fastify.db),
      emailSender: fastify.emailSender,
      checkPwnedPassword: fastify.checkPwnedPassword,
      log: fastify.log,
    }),
  );
};

export default fp(plugin, {
  name: "auth",
  dependencies: ["database", "email-sender", "pwned-password"],
});
