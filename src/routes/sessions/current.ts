import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppOptions } from "../../app-options.js";
import { cookiePolicy } from "../../lib/cookies.js";
import { resolveTtl } from "../../lib/ttl.js";
import { noContentSchema } from "../../schemas/auth.js";

const routes: FastifyPluginAsyncZod<AppOptions> = async (app, opts) => {
  const cookies = cookiePolicy(resolveTtl(opts.ttl));
  app.delete(
    "/current",
    {
      schema: {
        tags: ["sessions"],
        summary: "Sign out of this device",
        description:
          "Deletes the session behind the cookie of this request and clears " +
          "the cookie. Only this device is signed out: other sessions of the " +
          "same user stay active. The response is 204 whether the cookie was " +
          "missing, unknown, already signed out or expired, so signing out never " +
          "reports the state of a session back to the caller.",
        response: {
          204: noContentSchema,
        },
      },
    },
    async (request, reply) => {
      await app.sessions.logout(request.cookies[cookies.session.name]);

      // The full cookie options, not just the path: a deletion cookie without
      // Secure does not overwrite a Secure one in every browser, and the
      // session would survive the logout. clearCookie forces Max-Age=0.
      reply.clearCookie(cookies.session.name, cookies.session.options);
      return reply.code(204).send();
    },
  );
};

export default routes;
