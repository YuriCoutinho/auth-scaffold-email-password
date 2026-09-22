import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { SESSION_COOKIE } from "../../lib/cookies.js";
import { deviceLabelFromUserAgent } from "../../lib/device-label.js";
import {
  loginBodySchema,
  loginResponseSchema,
  messageSchema,
} from "../../schemas/auth.js";

const routes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/login",
    {
      schema: {
        tags: ["auth"],
        summary: "Sign in with email and password",
        description:
          "Verifies the credentials of a confirmed account and starts a new " +
          "session for this device. The error response is intentionally " +
          "generic and identical whether the email is unknown or the " +
          "password is wrong.",
        body: loginBodySchema,
        response: {
          200: loginResponseSchema,
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
      return reply.code(200).send({ user: result.user });
    },
  );
};

export default routes;
