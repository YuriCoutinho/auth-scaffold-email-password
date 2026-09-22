import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { SIGNUP_SESSION_COOKIE } from "../../lib/cookies.js";
import { messageSchema, signupBodySchema } from "../../schemas/auth.js";

const routes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/signup",
    {
      schema: {
        tags: ["auth"],
        summary: "Start an email/password signup",
        description:
          "Creates a pending signup and emails a 6-digit confirmation code. " +
          "The response is intentionally generic and identical whether or not " +
          "the email is already registered.",
        body: signupBodySchema,
        response: {
          202: messageSchema,
          400: messageSchema,
          503: messageSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await app.auth.signup(
        request.body.email,
        request.body.password,
      );

      if (result.outcome === "pwned-password") {
        return reply.code(400).send({
          message:
            "This password has appeared in a known data breach. Please choose a different one.",
        });
      }

      if (result.outcome === "email-unavailable") {
        return reply.code(503).send({
          message:
            "We could not send the confirmation email right now. Please try again shortly.",
        });
      }

      reply.setCookie(
        SIGNUP_SESSION_COOKIE.name,
        result.sessionToken,
        SIGNUP_SESSION_COOKIE.options,
      );
      return reply.code(202).send({
        message: "If the email is valid, we sent a confirmation code.",
      });
    },
  );
};

export default routes;
