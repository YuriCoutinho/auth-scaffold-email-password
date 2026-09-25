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
import changePasswordRoute from "./features/change-password/route.js";
import forgotPasswordRoute from "./features/forgot-password/route.js";
import healthRoute from "./features/health/route.js";
import listSessionsRoute from "./features/list-sessions/route.js";
import loginRoute from "./features/login/route.js";
import logoutRoute from "./features/logout/route.js";
import logoutAllRoute from "./features/logout-all/route.js";
import meRoute from "./features/me/route.js";
import resendSignupCodeRoute from "./features/resend-signup-code/route.js";
import resetPasswordRoute from "./features/reset-password/route.js";
import revokeSessionRoute from "./features/revoke-session/route.js";
import signupRoute from "./features/signup/route.js";
import verifySignupRoute from "./features/verify-signup/route.js";
import authenticate from "./http/authenticate.js";
import credentialThrottleModule from "./modules/credential-throttle/index.js";
import otpModule from "./modules/otp/index.js";
import sessionsModule from "./modules/sessions/index.js";
import usersModule from "./modules/users/index.js";
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
  await fastify.register(usersModule, opts);
  await fastify.register(credentialThrottleModule, opts);
  await fastify.register(otpModule, opts);
  await fastify.register(authenticate, opts);

  await fastify.register(healthRoute);
  await fastify.register(meRoute);

  // Temporary: only the retention sweep is still loaded this way.
  const load = (dir: string) =>
    fastify.register(autoload, {
      dir: join(import.meta.dirname, dir),
      options: opts,
      forceESM: true,
    });
  await load("plugins/app");

  // Registered in the order the route table was pinned in before this
  // migration.
  const auth = { ...opts, prefix: "/auth" };
  await fastify.register(changePasswordRoute, auth);
  await fastify.register(forgotPasswordRoute, auth);
  await fastify.register(loginRoute, auth);
  await fastify.register(resendSignupCodeRoute, auth);
  await fastify.register(resetPasswordRoute, auth);
  await fastify.register(signupRoute, auth);
  await fastify.register(verifySignupRoute, auth);
  await fastify.register(logoutAllRoute, { prefix: "/sessions" });
  await fastify.register(logoutRoute, { ...opts, prefix: "/sessions" });
  await fastify.register(listSessionsRoute, { prefix: "/sessions" });
  await fastify.register(revokeSessionRoute, { prefix: "/sessions" });
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
