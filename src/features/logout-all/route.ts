import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireAuth } from "../../http/authenticate.js";
import { logoutAllSchema } from "./schema.js";
import { createLogoutAll } from "./use-case.js";

const route: FastifyPluginAsyncZod = async (app) => {
  const logoutAll = createLogoutAll({ sessions: app.sessions, log: app.log });

  app.delete(
    "/",
    { onRequest: [app.authenticate], schema: logoutAllSchema },
    async (request, reply) => {
      const { userId, sessionId } = requireAuth(request);
      await logoutAll({ userId, currentSessionId: sessionId });
      return reply.code(204).send();
    },
  );
};

export default route;
