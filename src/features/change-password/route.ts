import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppOptions } from "../../app-options.js";
import { requireAuth } from "../../http/authenticate.js";
import { rateLimitFor } from "../../lib/rate-limit.js";
import { changePasswordSchema } from "./schema.js";
import { createChangePassword } from "./use-case.js";

const route: FastifyPluginAsyncZod<AppOptions> = async (app, opts) => {
  const changePassword = createChangePassword({
    transaction: app.transaction,
    users: app.users,
    sessions: app.sessions,
    credentialThrottle: app.credentialThrottle,
    checkPwnedPassword: app.checkPwnedPassword,
    log: app.log,
  });

  app.post(
    "/change-password",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimitFor("changePassword", opts.rateLimit) },
      schema: changePasswordSchema,
    },
    async (request, reply) => {
      const { userId, sessionId } = requireAuth(request);

      const result = await changePassword({
        userId,
        currentSessionId: sessionId,
        currentPassword: request.body.currentPassword,
        newPassword: request.body.newPassword,
      });

      switch (result.outcome) {
        case "throttled":
          return reply
            .code(429)
            .header("Retry-After", String(result.retryAfterSeconds))
            .send({ message: "Too many attempts. Try again later." });
        case "invalid-current-password":
          return reply
            .code(400)
            .send({ message: "The current password is incorrect." });
        case "same-password":
          return reply.code(400).send({
            message: "The new password must be different from the current one.",
          });
        case "pwned-password":
          return reply.code(400).send({
            message:
              "This password has appeared in a known data breach. Please choose a different one.",
          });
        case "changed":
          return reply.code(204).send();
      }
    },
  );
};

export default route;
