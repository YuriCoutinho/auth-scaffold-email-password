import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { SESSION_COOKIE } from "../../lib/cookies.js";
import {
  logoutAllBodySchema,
  messageSchema,
  noContentSchema,
} from "../../schemas/auth.js";

const routes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/logout-all",
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ["auth"],
        summary: "Sign out of every device",
        description:
          "Revokes every session of the signed-in user. The session behind " +
          "this request is kept by default, so signing out everywhere does " +
          "not lock the caller out of the device asking for it. Sending " +
          "includeCurrentSession revokes that one too, and only then is the " +
          "session cookie cleared. Requires a valid session, so the response " +
          "is 401 whenever the cookie is missing, unknown, revoked or expired.",
        // The schema admits a null body because Fastify's validation step
        // turns a missing one into `null` before Ajv sees it, which is what
        // makes the plain `fetch(url, { method: "POST" })` the frontend sends
        // valid instead of a 400.
        body: logoutAllBodySchema,
        response: {
          204: noContentSchema,
          401: messageSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user || !request.session) {
        // The route declares the hook, so nothing here means the hook was
        // dropped from the route, not that the caller is unauthorized.
        throw new Error("Route reached without the authenticate hook");
      }

      const { currentSessionRevoked } = await app.auth.logoutAll({
        userId: request.user.id,
        currentSessionId: request.session.id,
        includeCurrentSession: request.body?.includeCurrentSession ?? false,
      });

      if (currentSessionRevoked) {
        // The full cookie options, not just the path: a deletion cookie without
        // Secure does not overwrite a Secure one in every browser, and the
        // session would survive. clearCookie forces Max-Age=0.
        reply.clearCookie(SESSION_COOKIE.name, SESSION_COOKIE.options);
      }

      return reply.code(204).send();
    },
  );
};

export default routes;
