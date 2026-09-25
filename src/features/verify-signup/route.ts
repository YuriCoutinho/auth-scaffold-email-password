import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppOptions } from "../../app-options.js";
import { cookiePolicy } from "../../lib/cookies.js";
import { deviceLabelFromUserAgent } from "../../lib/device-label.js";
import { rateLimitFor } from "../../lib/rate-limit.js";
import { resolveTtl } from "../../lib/ttl.js";
import { verifySignupSchema } from "./schema.js";
import { createVerifySignup } from "./use-case.js";

const route: FastifyPluginAsyncZod<AppOptions> = async (app, opts) => {
  const cookies = cookiePolicy(resolveTtl(opts.ttl));
  const verifySignup = createVerifySignup({
    transaction: app.transaction,
    otp: app.otp,
    users: app.users,
    sessions: app.sessions,
    log: app.log,
  });

  app.post(
    "/verify-code",
    {
      config: { rateLimit: rateLimitFor("verifyCode", opts.rateLimit) },
      schema: verifySignupSchema,
    },
    async (request, reply) => {
      const deviceLabel = deviceLabelFromUserAgent(
        request.headers["user-agent"],
      );
      const result = await verifySignup(
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

export default route;
