import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { SESSION_COOKIE, SIGNUP_SESSION_COOKIE } from "../../lib/cookies.js";
import { deviceLabelFromUserAgent } from "../../lib/device-label.js";
import {
  messageSchema,
  noContentSchema,
  verifyCodeBodySchema,
} from "../../schemas/auth.js";

const routes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/verify-code",
    {
      schema: {
        tags: ["auth"],
        summary: "Confirm the signup code and sign in",
        description:
          "Verifies the 6-digit code for the pending signup identified by the " +
          "signup_session cookie, promotes it to a real account and starts an " +
          "authenticated session. The session lives only in the cookie: the " +
          "signed-in user is read from GET /me. The error response is " +
          "intentionally generic.",
        body: verifyCodeBodySchema,
        response: {
          204: noContentSchema,
          400: messageSchema,
          401: messageSchema,
        },
      },
    },
    async (request, reply) => {
      const deviceLabel = deviceLabelFromUserAgent(
        request.headers["user-agent"],
      );
      const result = await app.auth.verifyCode(
        request.cookies[SIGNUP_SESSION_COOKIE.name],
        request.body.code,
        deviceLabel,
      );

      if (result.outcome === "invalid") {
        return reply.code(401).send({ message: "Invalid or expired code." });
      }

      reply.clearCookie(SIGNUP_SESSION_COOKIE.name, {
        path: SIGNUP_SESSION_COOKIE.options.path,
      });
      reply.setCookie(
        SESSION_COOKIE.name,
        result.sessionToken,
        SESSION_COOKIE.options,
      );
      return reply.code(204).send();
    },
  );
};

export default routes;
