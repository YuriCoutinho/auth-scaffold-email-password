import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { SESSION_TTL_SECONDS } from "../../lib/session.js";
import type { VerifyCodeService } from "../../services/verify-code.js";

const verifyCodeBodySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

const messageSchema = z.object({ message: z.string() });

export interface VerifyCodeRoutesOptions {
  verifyCodeService: VerifyCodeService;
}

export const verifyCodeRoutes: FastifyPluginAsyncZod<
  VerifyCodeRoutesOptions
> = async (app, opts) => {
  app.post(
    "/auth/verify-code",
    {
      schema: {
        tags: ["auth"],
        summary: "Confirm the signup code and sign in",
        description:
          "Verifies the 6-digit code for the pending signup identified by the " +
          "signup_session cookie, promotes it to a real account and starts an " +
          "authenticated session. The error response is intentionally generic.",
        body: verifyCodeBodySchema,
        response: {
          200: messageSchema,
          400: messageSchema,
          401: messageSchema,
        },
      },
    },
    async (request, reply) => {
      const deviceLabel = request.headers["user-agent"]?.slice(0, 256) ?? null;
      const result = await opts.verifyCodeService.verifyCode(
        request.cookies.signup_session,
        request.body.code,
        deviceLabel,
      );

      if (result.outcome === "invalid") {
        return reply.code(401).send({ message: "Invalid or expired code." });
      }

      reply.clearCookie("signup_session", { path: "/auth" });
      reply.setCookie("session", result.sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
      });
      return reply.code(200).send({
        message: "Email confirmed. You are now signed in.",
      });
    },
  );
};
