import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  changePasswordBodySchema,
  messageSchema,
  noContentSchema,
} from "../../schemas/auth.js";

const routes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/change-password",
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ["auth"],
        summary: "Change the password of the signed-in user",
        description:
          "Replaces the password after confirming the current one, and " +
          "revokes every other session of the user so a stolen cookie stops " +
          "working. The session behind this request is preserved, so the " +
          "caller stays signed in on this device. Requires a valid session, " +
          "so the response is 401 whenever the cookie is missing, unknown, " +
          "revoked or expired. Repeated wrong current passwords are " +
          "throttled, and the 429 carries Retry-After in seconds.",
        body: changePasswordBodySchema,
        response: {
          204: noContentSchema,
          400: messageSchema,
          401: messageSchema,
          429: messageSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user || !request.session) {
        // The route declares the hook, so nothing here means the hook was
        // dropped from the route, not that the caller is unauthorized.
        throw new Error("Route reached without the authenticate hook");
      }

      const result = await app.auth.changePassword({
        userId: request.user.id,
        currentSessionId: request.session.id,
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

export default routes;
