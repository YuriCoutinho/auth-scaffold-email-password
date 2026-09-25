import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireAuth } from "../../http/authenticate.js";
import { listSessionsSchema } from "./schema.js";
import { createListSessions } from "./use-case.js";

const route: FastifyPluginAsyncZod = async (app) => {
  const listSessions = createListSessions({ sessions: app.sessions });

  app.get(
    "/",
    { onRequest: [app.authenticate], schema: listSessionsSchema },
    async (request, reply) => {
      const { userId, sessionId } = requireAuth(request);

      const sessions = await listSessions({
        userId,
        currentSessionId: sessionId,
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

export default route;
