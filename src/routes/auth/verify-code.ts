import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppOptions } from "../../app-options.js";
import { cookiePolicy } from "../../lib/cookies.js";
import { deviceLabelFromUserAgent } from "../../lib/device-label.js";
import { rateLimitFor } from "../../lib/rate-limit.js";
import { resolveTtl } from "../../lib/ttl.js";
import {
  messageSchema,
  noContentSchema,
  verifyCodeBodySchema,
} from "../../schemas/auth.js";

const routes: FastifyPluginAsyncZod<AppOptions> = async (app, opts) => {
  const cookies = cookiePolicy(resolveTtl(opts.ttl));
  app.post(
    "/verify-code",
    {
      config: { rateLimit: rateLimitFor("verifyCode", opts.rateLimit) },
      schema: {
        tags: ["auth"],
        summary: "Confirm the signup code and sign in",
        description:
          "Verifies the 6-digit code for the unconfirmed account identified " +
          "by the signup_session cookie, confirms the account and starts an " +
          "authenticated session. The session lives only in the cookie: the " +
          "signed-in user is read from GET /me. The error response is " +
          "intentionally generic.",
        body: verifyCodeBodySchema,
        response: {
          204: noContentSchema,
          400: messageSchema,
          401: messageSchema,
          429: messageSchema,
        },
      },
    },
    async (request, reply) => {
      const deviceLabel = deviceLabelFromUserAgent(
        request.headers["user-agent"],
      );
      const result = await app.auth.verifyCode(
        request.cookies[cookies.signupSession.name],
        request.body.code,
        deviceLabel,
      );

      if (result.outcome === "invalid") {
        return reply.code(401).send({ message: "Invalid or expired code." });
      }

      reply.clearCookie(cookies.signupSession.name, {
        path: cookies.signupSession.options.path,
      });
      reply.setCookie(
        cookies.session.name,
        result.sessionToken,
        cookies.session.options,
      );
      return reply.code(204).send();
    },
  );
};

export default routes;
