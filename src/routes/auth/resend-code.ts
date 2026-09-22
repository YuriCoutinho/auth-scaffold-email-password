import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { SIGNUP_SESSION_COOKIE } from "../../lib/cookies.js";
import { messageSchema } from "../../schemas/auth.js";

const routes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/resend-code",
    {
      schema: {
        tags: ["auth"],
        summary: "Resend the signup confirmation code",
        description:
          "Issues a fresh confirmation code for the pending signup identified " +
          "by the signup_session cookie. Guarded by a per-signup cooldown and " +
          "a total send cap.",
        response: {
          202: messageSchema,
          401: messageSchema,
          429: messageSchema,
          503: messageSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await app.auth.resendCode(
        request.cookies[SIGNUP_SESSION_COOKIE.name],
      );

      switch (result.outcome) {
        case "invalid-session":
          return reply
            .code(401)
            .send({ message: "Invalid or expired signup session." });
        case "cooldown":
          return reply
            .code(429)
            .send({ message: "Please wait before requesting another code." });
        case "limit-reached":
          return reply.code(429).send({
            message:
              "Code resend limit reached. Wait for the current signup to expire and sign up again.",
          });
        case "email-unavailable":
          return reply.code(503).send({
            message:
              "We could not send the confirmation email right now. Please try again shortly.",
          });
        case "sent":
          reply.setCookie(
            SIGNUP_SESSION_COOKIE.name,
            result.sessionToken,
            SIGNUP_SESSION_COOKIE.options,
          );
          return reply.code(202).send({
            message:
              "If your signup is still pending, we sent a new confirmation code.",
          });
      }
    },
  );
};

export default routes;
