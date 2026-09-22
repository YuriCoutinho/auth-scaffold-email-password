import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../plugins/app/auth/create-auth.js";
import { SIGNUP_TTL_SECONDS } from "../../plugins/app/auth/signup.js";

const signupBodySchema = z.object({
  email: z.email().max(254),
  password: z.string().min(15).max(128),
});

const messageSchema = z.object({ message: z.string() });

export interface AuthRoutesOptions {
  auth: Auth;
}

export const signupRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (
  app,
  opts,
) => {
  app.post(
    "/auth/signup",
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
      const result = await opts.auth.signup(
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

      reply.setCookie("signup_session", result.sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/auth",
        maxAge: SIGNUP_TTL_SECONDS,
      });
      return reply.code(202).send({
        message: "If the email is valid, we sent a confirmation code.",
      });
    },
  );
};
