import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { SESSION_COOKIE } from "../../lib/cookies.js";
import { noContentSchema } from "../../schemas/auth.js";

const routes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/logout",
    {
      schema: {
        tags: ["auth"],
        summary: "Sign out of this device",
        description:
          "Revokes the session behind the cookie of this request and clears " +
          "the cookie. Only this device is signed out: other sessions of the " +
          "same user stay active. The response is 204 whether the cookie was " +
          "missing, unknown, already revoked or expired, so signing out never " +
          "reports the state of a session back to the caller.",
        response: {
          204: noContentSchema,
        },
      },
    },
    async (request, reply) => {
      await app.auth.logout(request.cookies[SESSION_COOKIE.name]);

      // The full cookie options, not just the path: a deletion cookie without
      // Secure does not overwrite a Secure one in every browser, and the
      // session would survive the logout. clearCookie forces Max-Age=0.
      reply.clearCookie(SESSION_COOKIE.name, SESSION_COOKIE.options);
      return reply.code(204).send();
    },
  );
};

export default routes;
