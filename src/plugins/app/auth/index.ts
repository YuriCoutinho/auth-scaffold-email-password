import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../../../app-options.js";
import { createDrizzleSessionRepository } from "../sessions/drizzle-repository.js";
import { type Auth, createAuth } from "./create-auth.js";
import { createDrizzleAuthRepository } from "./drizzle-repository.js";
import { SIGNUP_CODE_EMAIL_TYPE } from "./emails/signup-code.js";

declare module "fastify" {
  interface FastifyInstance {
    auth: Auth;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  const repository =
    opts.authRepository ?? createDrizzleAuthRepository(fastify.db);

  fastify.decorate(
    "auth",
    createAuth({
      repository,
      sessionRepository:
        opts.sessionRepository ?? createDrizzleSessionRepository(fastify.db),
      checkPwnedPassword: fastify.checkPwnedPassword,
      log: fastify.log,
    }),
  );

  // A code the user never received must not consume the resend quota nor start
  // a cooldown. The outbox retries a transient failure on its own, so this runs
  // only once delivery has definitively failed, and the correlation (the hash
  // of the code that failed) keeps it from freeing quota that a later, and
  // delivered, code has already spent.
  fastify.emailOutbox.onGiveUp(
    SIGNUP_CODE_EMAIL_TYPE,
    async (recipient, correlationId) => {
      if (correlationId === null) {
        return;
      }
      await repository.markPendingSignupUndeliveredIfCurrent(
        recipient,
        correlationId,
      );
    },
  );
};

export default fp(plugin, {
  name: "auth",
  dependencies: ["database", "email-outbox", "pwned-password"],
});
