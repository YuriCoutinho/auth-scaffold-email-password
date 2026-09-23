import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { SESSION_COOKIE } from "../../lib/cookies.js";
import { deviceLabelFromUserAgent } from "../../lib/device-label.js";
import { loginBodySchema, messageSchema } from "../../schemas/auth.js";

const routes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/login",
    {
      schema: {
        tags: ["auth"],
        summary: "Sign in with email and password",
        description:
          "Verifies the credentials of a confirmed account and starts a new " +
          "session for this device. The session lives only in the cookie: " +
          "the signed-in user is read from GET /me. The error response is " +
          "intentionally generic and identical whether the email is unknown " +
          "or the password is wrong.",
        body: loginBodySchema,
        response: {
          204: z.null(),
          400: messageSchema,
          401: messageSchema,
        },
      },
    },
    async (request, reply) => {
      const deviceLabel = deviceLabelFromUserAgent(
        request.headers["user-agent"],
      );
      const result = await app.auth.login(
        request.body.email,
        request.body.password,
        deviceLabel,
      );

      if (result.outcome === "invalid") {
        return reply.code(401).send({ message: "Invalid credentials." });
      }

      reply.setCookie(
        SESSION_COOKIE.name,
        result.sessionToken,
        SESSION_COOKIE.options,
      );
      return reply.code(204).send(null);
    },
  );
};

export default routes;
