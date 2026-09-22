import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../../app-options.js";
import { createEmailSender } from "./create-sender.js";
import type { EmailSender } from "./sender.js";

declare module "fastify" {
  interface FastifyInstance {
    emailSender: EmailSender;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  fastify.decorate(
    "emailSender",
    opts.emailSender ?? createEmailSender(opts.config),
  );
};

export default fp(plugin, { name: "email-sender" });
