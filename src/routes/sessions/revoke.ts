import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { messageSchema, noContentSchema } from "../../schemas/auth.js";
import { sessionParamsSchema } from "../../schemas/sessions.js";

const routes: FastifyPluginAsyncZod = async (app) => {
  app.delete(
    "/:sessionId",
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ["sessions"],
        summary: "Revoke one session of the signed-in user",
        description:
          "Deletes the session named in the path, which is the id the " +
          "session listing returns. Only a session of the signed-in user is " +
          "ever deleted. The response is 204 whether the session was " +
          "deleted, never existed, belongs to someone else, was already " +
          "signed out or had expired, so the endpoint never reports whose " +
          "sessions exist. Signing this device out is DELETE " +
          "/sessions/current, and the session listing marks which row that " +
          "is with isCurrent.",
        params: sessionParamsSchema,
        response: {
          204: noContentSchema,
          400: messageSchema,
          401: messageSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        // The route declares the hook, so nothing here means the hook was
        // dropped from the route, not that the caller is unauthorized.
        throw new Error("Route reached without the authenticate hook");
      }

      await app.legacySessions.revokeSession({
        userId: request.user.id,
        sessionId: request.params.sessionId,
      });

      return reply.code(204).send();
    },
  );
};

export default routes;
