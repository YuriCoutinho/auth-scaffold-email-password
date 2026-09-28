import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppOptions } from "../../app-options.js";
import { cookiePolicy } from "../../lib/cookies.js";
import { rateLimitFor } from "../../lib/rate-limit.js";
import { resolveTtl } from "../../lib/ttl.js";
import { resendSignupCodeSchema } from "./schema.js";
import { createResendSignupCode } from "./use-case.js";

const route: FastifyPluginAsyncZod<AppOptions> = async (app, opts) => {
  const cookies = cookiePolicy(resolveTtl(opts.ttl));
  const resendSignupCode = createResendSignupCode({ otp: app.otp });

  app.post(
    "/resend-code",
    {
      config: { rateLimit: rateLimitFor("resendCode", opts.rateLimit) },
      schema: resendSignupCodeSchema,
    },
    async (request, reply) => {
      const result = await resendSignupCode(
        request.cookies[cookies.signupSession.name],
      );

      switch (result.outcome) {
        case "invalid-session":
          return reply
            .code(401)
            .send({ message: "Invalid or expired signup session." });
        case "cooldown":
          return reply
            .code(429)
            .send({ message: "Please wait before requesting another code." });
        case "limit-reached":
          return reply.code(429).send({
            message:
              "Code resend limit reached. Wait for the current signup to expire and sign up again.",
          });
        case "email-unavailable":
          return reply.code(503).send({
            message:
              "We could not send the confirmation email right now. Please try again shortly.",
          });
        case "sent":
          reply.setCookie(
            cookies.signupSession.name,
            result.sessionToken,
            cookies.signupSession.options,
          );
          return reply.code(202).send({
            message:
              "If your signup is still pending, we sent a new confirmation code.",
          });
      }
    },
  );
};

export default route;
