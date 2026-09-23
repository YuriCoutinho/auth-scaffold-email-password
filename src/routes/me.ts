import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { currentUserResponseSchema, messageSchema } from "../schemas/auth.js";

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/me",
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ["auth"],
        summary: "Read the signed-in user",
        description:
          "Resolves the session cookie and returns the public data of the " +
          "user behind it. This is how the frontend learns who is signed in " +
          "on boot. The error response is intentionally generic and identical " +
          "whether the cookie is missing, unknown, revoked or expired.",
        response: {
          200: currentUserResponseSchema,
          401: messageSchema,
        },
      },
    },
    async (request, reply) => {
      const user = await app.auth.currentUser(request.user.id);

      if (!user) {
        // The session FK cascades on user deletion, so a session without its
        // user means the data is broken, not that the caller is unauthorized.
        throw new Error("Authenticated session points to a missing user");
      }

      return reply.code(200).send({ user });
    },
  );
};

export default routes;
