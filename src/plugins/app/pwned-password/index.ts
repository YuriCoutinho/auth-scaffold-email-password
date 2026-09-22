import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import {
  type CheckPwnedPassword,
  createPwnedPasswordChecker,
} from "./checker.js";

declare module "fastify" {
  interface FastifyInstance {
    checkPwnedPassword: CheckPwnedPassword;
  }
}

const plugin: FastifyPluginAsync<{
  checkPwnedPassword?: CheckPwnedPassword;
}> = async (fastify, opts) => {
  fastify.decorate(
    "checkPwnedPassword",
    opts.checkPwnedPassword ??
      createPwnedPasswordChecker({
        onError: (error) =>
          fastify.log.warn({ err: error }, "pwned password check failed open"),
      }),
  );
};

export default fp(plugin, { name: "pwned-password" });
