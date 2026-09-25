import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../app-options.js";
import type { Executor, Transaction } from "../../db/client.js";
import { resolveTtl } from "../../lib/ttl.js";
import { createDrizzleOtpRepository } from "./drizzle-repository.js";
import { createOtpService, type OtpService } from "./service.js";

// A service bound to a transaction has no dispatch: the email may only leave
// once the transaction commits, and the compensation for a failed delivery
// has to run on the database rather than on a transaction already closed.
export type OtpModule = OtpService & {
  inTx(tx: Transaction): Omit<OtpService, "dispatch">;
};

declare module "fastify" {
  interface FastifyInstance {
    otp: OtpModule;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  const repositoryFor = opts.repositories?.otp ?? createDrizzleOtpRepository;
  const ttl = resolveTtl(opts.ttl);
  const build = (executor: Executor) =>
    createOtpService({
      repo: repositoryFor(executor),
      emailSender: fastify.emailSender,
      ttl,
      hmacSecret: opts.config.HMAC_SECRET,
      log: fastify.log,
    });
  fastify.decorate("otp", {
    ...build(fastify.db),
    inTx(tx: Transaction) {
      const { dispatch: _dispatch, ...scoped } = build(tx);
      return scoped;
    },
  });
};

export default fp(plugin, {
  name: "otp",
  dependencies: ["database", "email-sender"],
});
