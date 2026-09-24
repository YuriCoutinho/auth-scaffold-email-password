import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppOptions } from "../../app-options.js";
import { PASSWORD_RESET_COOKIE, SESSION_COOKIE } from "../../lib/cookies.js";
import { deviceLabelFromUserAgent } from "../../lib/device-label.js";
import { rateLimitFor } from "../../lib/rate-limit.js";
import {
  messageSchema,
  noContentSchema,
  resetPasswordBodySchema,
} from "../../schemas/auth.js";

const routes: FastifyPluginAsyncZod<AppOptions> = async (app, opts) => {
  app.post(
    "/reset-password",
    {
      config: { rateLimit: rateLimitFor("resetPassword", opts.rateLimit) },
      schema: {
        tags: ["auth"],
        summary: "Finish a password reset and sign in",
        description:
          "Verifies the 6-digit code for the reset identified by the " +
          "password_reset cookie, stores the new password, revokes every " +
          "session of the account and starts a new one. Everything about the " +
          "code answers with the same generic 401, because telling the cases " +
          "apart would reveal which addresses have accounts.",
        body: resetPasswordBodySchema,
        response: {
          204: noContentSchema,
          400: messageSchema,
          401: messageSchema,
          429: messageSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await app.auth.resetPassword({
        sessionToken: request.cookies[PASSWORD_RESET_COOKIE.name],
        code: request.body.code,
        newPassword: request.body.newPassword,
        deviceLabel: deviceLabelFromUserAgent(request.headers["user-agent"]),
      });

      switch (result.outcome) {
        case "invalid":
          return reply.code(401).send({ message: "Invalid or expired code." });
        case "same-password":
          return reply.code(400).send({
            message: "The new password must be different from the current one.",
          });
        case "pwned-password":
          return reply.code(400).send({
            message:
              "This password has appeared in a known data breach. Please choose a different one.",
          });
        case "reset":
          reply.clearCookie(PASSWORD_RESET_COOKIE.name, {
            path: PASSWORD_RESET_COOKIE.options.path,
          });
          reply.setCookie(
            SESSION_COOKIE.name,
            result.sessionToken,
            SESSION_COOKIE.options,
          );
          return reply.code(204).send();
      }
    },
  );
};

export default routes;
