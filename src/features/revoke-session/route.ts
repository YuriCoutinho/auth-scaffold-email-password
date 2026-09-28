import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireAuth } from "../../http/authenticate.js";
import { revokeSessionSchema } from "./schema.js";
import { createRevokeSession } from "./use-case.js";

const route: FastifyPluginAsyncZod = async (app) => {
  const revokeSession = createRevokeSession({
    sessions: app.sessions,
    log: app.log,
  });

  app.delete(
    "/:sessionId",
    { onRequest: [app.authenticate], schema: revokeSessionSchema },
    async (request, reply) => {
      const { userId } = requireAuth(request);

      await revokeSession({ userId, sessionId: request.params.sessionId });

      return reply.code(204).send();
    },
  );
};

export default route;
