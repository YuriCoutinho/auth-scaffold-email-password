import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppOptions } from "../../app-options.js";
import { cookiePolicy } from "../../lib/cookies.js";
import { deviceLabelFromUserAgent } from "../../lib/device-label.js";
import { rateLimitFor } from "../../lib/rate-limit.js";
import { resolveTtl } from "../../lib/ttl.js";
import { loginSchema } from "./schema.js";
import { createLogin } from "./use-case.js";

const route: FastifyPluginAsyncZod<AppOptions> = async (app, opts) => {
  const cookies = cookiePolicy(resolveTtl(opts.ttl));
  const login = createLogin({
    users: app.users,
    sessions: app.sessions,
    credentialThrottle: app.credentialThrottle,
    log: app.log,
  });

  app.post(
    "/login",
    {
      config: { rateLimit: rateLimitFor("login", opts.rateLimit) },
      schema: loginSchema,
    },
    async (request, reply) => {
      const deviceLabel = deviceLabelFromUserAgent(
        request.headers["user-agent"],
      );
      const result = await login(
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

export default route;
