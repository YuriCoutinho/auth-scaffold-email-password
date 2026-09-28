import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppOptions } from "../../app-options.js";
import { cookiePolicy } from "../../lib/cookies.js";
import { deviceLabelFromUserAgent } from "../../lib/device-label.js";
import { rateLimitFor } from "../../lib/rate-limit.js";
import { resolveTtl } from "../../lib/ttl.js";
import { resetPasswordSchema } from "./schema.js";
import { createResetPassword } from "./use-case.js";

const route: FastifyPluginAsyncZod<AppOptions> = async (app, opts) => {
  const cookies = cookiePolicy(resolveTtl(opts.ttl));
  const resetPassword = createResetPassword({
    transaction: app.transaction,
    otp: app.otp,
    users: app.users,
    sessions: app.sessions,
    credentialThrottle: app.credentialThrottle,
    checkPwnedPassword: app.checkPwnedPassword,
    log: app.log,
  });

  app.post(
    "/reset-password",
    {
      config: { rateLimit: rateLimitFor("resetPassword", opts.rateLimit) },
      schema: resetPasswordSchema,
    },
    async (request, reply) => {
      const result = await resetPassword({
        sessionToken: request.cookies[cookies.passwordReset.name],
        code: request.body.code,
        newPassword: request.body.newPassword,
        deviceLabel: deviceLabelFromUserAgent(request.headers["user-agent"]),
      });

      switch (result.outcome) {
        case "invalid":
          return reply.code(401).send({ message: "Invalid or expired code." });
        case "same-password":
          return reply.code(400).send({
            message: "The new password must be different from the current one.",
          });
        case "pwned-password":
          return reply.code(400).send({
            message:
              "This password has appeared in a known data breach. Please choose a different one.",
          });
        case "reset":
          reply.clearCookie(cookies.passwordReset.name, {
            path: cookies.passwordReset.options.path,
          });
          reply.setCookie(
            cookies.session.name,
            result.sessionToken,
            cookies.session.options,
          );
          return reply.code(204).send();
      }
    },
  );
};

export default route;
