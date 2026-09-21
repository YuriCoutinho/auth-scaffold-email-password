import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { SESSION_TTL_SECONDS } from "../../lib/session.js";
import type { LoginService } from "../../services/login.js";

const loginBodySchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

const loginResponseSchema = z.object({
  user: z.object({ publicId: z.uuid() }),
});

const messageSchema = z.object({ message: z.string() });

export interface LoginRoutesOptions {
  loginService: LoginService;
}

export const loginRoutes: FastifyPluginAsyncZod<LoginRoutesOptions> = async (
  app,
  opts,
) => {
  app.post(
    "/auth/login",
    {
      schema: {
        tags: ["auth"],
        summary: "Sign in with email and password",
        description:
          "Verifies the credentials of a confirmed account and starts a new " +
          "session for this device. The error response is intentionally " +
          "generic and identical whether the email is unknown or the " +
          "password is wrong.",
        body: loginBodySchema,
        response: {
          200: loginResponseSchema,
          400: messageSchema,
          401: messageSchema,
        },
      },
    },
    async (request, reply) => {
      const deviceLabel = request.headers["user-agent"]?.slice(0, 256) ?? null;
      const result = await opts.loginService.login(
        request.body.email,
        request.body.password,
        deviceLabel,
      );

      if (result.outcome === "invalid") {
        return reply.code(401).send({ message: "Invalid credentials." });
      }

      reply.setCookie("session", result.sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
      });
      return reply.code(200).send({ user: result.user });
    },
  );
};
