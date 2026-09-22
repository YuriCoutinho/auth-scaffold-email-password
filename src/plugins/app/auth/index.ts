import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../../app-options.js";
import { type Auth, createAuth } from "./create-auth.js";

declare module "fastify" {
  interface FastifyInstance {
    auth: Auth;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  fastify.decorate(
    "auth",
    createAuth({
      repository: opts.authRepository,
      emailSender: opts.emailSender,
      checkPwnedPassword: opts.checkPwnedPassword,
      log: fastify.log,
    }),
  );
};

export default fp(plugin, { name: "auth" });
