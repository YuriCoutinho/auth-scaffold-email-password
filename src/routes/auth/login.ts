import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppOptions } from "../../app-options.js";
import { cookiePolicy } from "../../lib/cookies.js";
import { deviceLabelFromUserAgent } from "../../lib/device-label.js";
import { rateLimitFor } from "../../lib/rate-limit.js";
import { resolveTtl } from "../../lib/ttl.js";
import {
  loginBodySchema,
  messageSchema,
  noContentSchema,
} from "../../schemas/auth.js";

const routes: FastifyPluginAsyncZod<AppOptions> = async (app, opts) => {
  const cookies = cookiePolicy(resolveTtl(opts.ttl));
  app.post(
    "/login",
    {
      config: { rateLimit: rateLimitFor("login", opts.rateLimit) },
      schema: {
        tags: ["auth"],
        summary: "Sign in with email and password",
        description:
          "Verifies the credentials of a confirmed account and starts a new " +
          "session for this device. The session lives only in the cookie: " +
          "the signed-in user is read from GET /me. The error response is " +
          "intentionally generic and identical whether the email is unknown " +
          "or the password is wrong. Repeated failures for the same email " +
          "are throttled, and the 429 carries Retry-After in seconds.",
        body: loginBodySchema,
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
      const result = await app.auth.login(
        request.body.email,
        request.body.password,
        deviceLabel,
      );

      if (result.outcome === "throttled") {
        return reply
          .code(429)
          .header("Retry-After", String(result.retryAfterSeconds))
          .send({ message: "Too many attempts. Try again later." });
      }

      if (result.outcome === "invalid") {
        return reply.code(401).send({ message: "Invalid credentials." });
      }

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
