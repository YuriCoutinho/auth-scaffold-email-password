import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppOptions } from "../../app-options.js";
import { cookiePolicy } from "../../lib/cookies.js";
import { rateLimitFor } from "../../lib/rate-limit.js";
import { resolveTtl } from "../../lib/ttl.js";
import { signupSchema } from "./schema.js";
import { createSignup } from "./use-case.js";

const route: FastifyPluginAsyncZod<AppOptions> = async (app, opts) => {
  const cookies = cookiePolicy(resolveTtl(opts.ttl));
  const signup = createSignup({
    transaction: app.transaction,
    users: app.users,
    otp: app.otp,
    checkPwnedPassword: app.checkPwnedPassword,
    log: app.log,
  });

  app.post(
    "/signup",
    {
      config: { rateLimit: rateLimitFor("signup", opts.rateLimit) },
      schema: signupSchema,
    },
    async (request, reply) => {
      const result = await signup(request.body.email, request.body.password);

      if (result.outcome === "pwned-password") {
        return reply.code(400).send({
          message:
            "This password has appeared in a known data breach. Please choose a different one.",
        });
      }

      reply.setCookie(
        cookies.signupSession.name,
        result.sessionToken,
        cookies.signupSession.options,
      );
      return reply.code(202).send({
        message: "If the email is valid, we sent a confirmation code.",
      });
    },
  );
};

export default route;
