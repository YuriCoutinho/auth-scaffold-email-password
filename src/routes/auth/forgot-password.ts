import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppOptions } from "../../app-options.js";
import { PASSWORD_RESET_COOKIE } from "../../lib/cookies.js";
import { rateLimitFor } from "../../lib/rate-limit.js";
import { forgotPasswordBodySchema, messageSchema } from "../../schemas/auth.js";

const routes: FastifyPluginAsyncZod<AppOptions> = async (app, opts) => {
  app.post(
    "/forgot-password",
    {
      config: { rateLimit: rateLimitFor("forgotPassword", opts.rateLimit) },
      schema: {
        tags: ["auth"],
        summary: "Start a password reset",
        description:
          "Emails a 6-digit reset code and sets the password_reset cookie. " +
          "Calling it again is the resend, subject to a cooldown and a send " +
          "cap. The response is intentionally generic and identical whether " +
          "or not the email belongs to an account, and the code is delivered " +
          "outside the request so the two cases cannot be told apart by how " +
          "long the response takes.",
        body: forgotPasswordBodySchema,
        response: {
          202: messageSchema,
          400: messageSchema,
          429: messageSchema,
        },
      },
    },
    async (request, reply) => {
      const { sessionToken } = await app.auth.forgotPassword(
        request.body.email,
      );

      reply.setCookie(
        PASSWORD_RESET_COOKIE.name,
        sessionToken,
        PASSWORD_RESET_COOKIE.options,
      );
      return reply.code(202).send({
        message: "If the email is valid, we sent a reset code.",
      });
    },
  );
};

export default routes;
