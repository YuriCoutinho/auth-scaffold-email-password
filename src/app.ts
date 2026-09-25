import { join } from "node:path";
import autoload from "@fastify/autoload";
import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
} from "fastify";
import fp from "fastify-plugin";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { AppOptions } from "./app-options.js";
import authenticate from "./http/authenticate.js";
import sessionsModule from "./modules/sessions/index.js";
import database from "./plugins/database.js";
import email from "./plugins/email/index.js";
import errorHandler from "./plugins/error-handler.js";
import cookie from "./plugins/external/cookie.js";
import cors from "./plugins/external/cors.js";
import helmet from "./plugins/external/helmet.js";
import rateLimit from "./plugins/external/rate-limit.js";
import swagger from "./plugins/external/swagger.js";
import swaggerUi from "./plugins/external/swagger-ui.js";
import pwnedPassword from "./plugins/pwned-password/index.js";
import transaction from "./plugins/transaction.js";

export type { AppOptions } from "./app-options.js";

const appPlugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  await fastify.register(cookie);
  await fastify.register(helmet, opts);
  await fastify.register(cors, opts);
  await fastify.register(rateLimit, opts);
  await fastify.register(swagger);
  await fastify.register(swaggerUi, opts);

  await fastify.register(database, opts);
  await fastify.register(transaction, opts);
  await fastify.register(errorHandler);
  await fastify.register(email, opts);
  await fastify.register(pwnedPassword, opts);

  await fastify.register(sessionsModule, opts);
  await fastify.register(authenticate, opts);

  // Temporary: emptied feature by feature, removed in the last task.
  const load = (dir: string) =>
    fastify.register(autoload, {
      dir: join(import.meta.dirname, dir),
      options: opts,
      forceESM: true,
    });
  await load("plugins/app");
  await load("routes");
};

export const app = fp(appPlugin, { name: "app" });

export function buildApp(opts: AppOptions): FastifyInstance {
  const instance = Fastify({
    logger: opts.logger ?? true,
  }).withTypeProvider<ZodTypeProvider>();
  instance.setValidatorCompiler(validatorCompiler);
  instance.setSerializerCompiler(serializerCompiler);
  instance.register(app, opts);
  return instance;
}
