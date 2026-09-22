import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { SIGNUP_TTL_SECONDS } from "../../plugins/app/auth/signup.js";
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
      const sessionToken = request.cookies.signup_session;
      const result = await app.auth.resendCode(sessionToken);

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
        case "sent": {
          // The service returns invalid-session for a missing token, so the
          // token is guaranteed here; the guard keeps the type narrow.
          if (!sessionToken) {
            return reply
              .code(401)
              .send({ message: "Invalid or expired signup session." });
          }
          reply.setCookie("signup_session", sessionToken, {
            httpOnly: true,
            secure: true,
            sameSite: "strict",
            path: "/auth",
            maxAge: SIGNUP_TTL_SECONDS,
          });
          return reply.code(202).send({
            message:
              "If your signup is still pending, we sent a new confirmation code.",
          });
        }
      }
    },
  );
};

export default routes;
