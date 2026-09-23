import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { messageSchema } from "../schemas/auth.js";
import { sessionListResponseSchema } from "../schemas/sessions.js";

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/sessions",
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ["sessions"],
        summary: "List the active sessions of the signed-in user",
        description:
          "Returns every session of the signed-in user that is neither " +
          "revoked nor expired, newest first, so a connected devices screen " +
          "can show them and revoke one. The session behind this request is " +
          "marked with isCurrent, so the caller can avoid signing itself out " +
          "by accident. The session token and its hash are never part of the " +
          "response. The error response is intentionally generic and " +
          "identical whether the cookie is missing, unknown, revoked or " +
          "expired.",
        response: {
          200: sessionListResponseSchema,
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

      const sessions = await app.sessions.listSessions({
        userId: request.user.id,
        currentSessionId: request.session.id,
      });

      return reply.code(200).send({
        sessions: sessions.map((session) => ({
          ...session,
          createdAt: session.createdAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
        })),
      });
    },
  );
};

export default routes;
