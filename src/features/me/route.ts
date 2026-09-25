import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireAuth } from "../../http/authenticate.js";
import { meSchema } from "./schema.js";
import { createMe } from "./use-case.js";

const route: FastifyPluginAsyncZod = async (app) => {
  const me = createMe({ findUser: (id) => app.users.publicProfile(id) });

  app.get(
    "/me",
    { onRequest: [app.authenticate], schema: meSchema },
    async (request, reply) => {
      const { userId } = requireAuth(request);

      const user = await me(userId);

      if (!user) {
        // The session FK cascades on user deletion, so a session without its
        // user means the data is broken, not that the caller is unauthorized.
        throw new Error("Authenticated session points to a missing user");
      }

      return reply.code(200).send({ user });
    },
  );
};

export default route;
