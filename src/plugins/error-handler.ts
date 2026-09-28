import type { FastifyError, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      // The default handler echoes error.message on 5xx, which leaks driver
      // and database details to the client.
      request.log.error({ err: error }, "unhandled error");
      return reply.code(500).send({ message: "Internal Server Error" });
    }

    request.log.info({ err: error }, "request rejected");
    return reply.code(statusCode).send({ message: error.message });
  });
};

export default fp(plugin, { name: "error-handler" });
