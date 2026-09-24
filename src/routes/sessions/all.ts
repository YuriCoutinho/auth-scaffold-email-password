import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { messageSchema, noContentSchema } from "../../schemas/auth.js";

const routes: FastifyPluginAsyncZod = async (app) => {
  app.delete(
    "/",
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ["sessions"],
        summary: "Sign out of every device",
        description:
          "Deletes every session of the signed-in user except the one " +
          "behind this request, which is always preserved so signing out " +
          "everywhere does not lock the caller out of the device asking for " +
          "it. Signing out of that one too is DELETE /sessions/current. " +
          "Requires a valid session, so the response is 401 whenever the " +
          "cookie is missing, unknown, signed out or expired.",
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

      await app.sessions.logoutAll({
        userId: request.user.id,
        currentSessionId: request.session.id,
      });

      return reply.code(204).send();
    },
  );
};

export default routes;
