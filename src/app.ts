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
import healthRoute from "./features/health/route.js";
import logoutRoute from "./features/logout/route.js";
import logoutAllRoute from "./features/logout-all/route.js";
import meRoute from "./features/me/route.js";
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

  await fastify.register(healthRoute);
  await fastify.register(meRoute);

  // Temporary: emptied feature by feature, removed in the last task.
  const load = (dir: string, ignorePattern?: RegExp) =>
    fastify.register(autoload, {
      dir: join(import.meta.dirname, dir),
      options: opts,
      forceESM: true,
      ...(ignorePattern ? { ignorePattern } : {}),
    });
  await load("plugins/app");
  // Split so logout and logout-all land between the auth routes and the
  // sessions routes still under autoload, which is what keeps the route
  // table byte-identical to the one pinned before this migration.
  await load("routes", /^sessions$/);
  await fastify.register(logoutRoute, { ...opts, prefix: "/sessions" });
  await fastify.register(logoutAllRoute, { prefix: "/sessions" });
  await load("routes", /^auth$/);
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
