import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppOptions } from "../../app-options.js";
import { cookiePolicy } from "../../lib/cookies.js";
import { rateLimitFor } from "../../lib/rate-limit.js";
import { resolveTtl } from "../../lib/ttl.js";
import { forgotPasswordSchema } from "./schema.js";
import { createForgotPassword } from "./use-case.js";

const route: FastifyPluginAsyncZod<AppOptions> = async (app, opts) => {
  const cookies = cookiePolicy(resolveTtl(opts.ttl));
  const forgotPassword = createForgotPassword({
    users: app.users,
    otp: app.otp,
  });

  app.post(
    "/forgot-password",
    {
      config: { rateLimit: rateLimitFor("forgotPassword", opts.rateLimit) },
      schema: forgotPasswordSchema,
    },
    async (request, reply) => {
      const { sessionToken } = await forgotPassword(request.body.email);

      reply.setCookie(
        cookies.passwordReset.name,
        sessionToken,
        cookies.passwordReset.options,
      );
      return reply.code(202).send({
        message: "If the email is valid, we sent a reset code.",
      });
    },
  );
};

export default route;
