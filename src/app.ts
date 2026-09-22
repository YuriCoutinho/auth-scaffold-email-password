import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { EmailSender } from "./email/email-sender.js";
import type { CheckPwnedPassword } from "./lib/pwned-password.js";
import type { AuthRepository } from "./plugins/app/auth/auth-repository.js";
import { createAuth } from "./plugins/app/auth/create-auth.js";
import { loginRoutes } from "./routes/auth/login.js";
import { resendCodeRoutes } from "./routes/auth/resend-code.js";
import { signupRoutes } from "./routes/auth/signup.js";
import { verifyCodeRoutes } from "./routes/auth/verify-code.js";
import { healthRoutes } from "./routes/health.js";

export interface AppOptions {
  authRepository: AuthRepository;
  emailSender: EmailSender;
  checkPwnedPassword: CheckPwnedPassword;
  enableDocsUi?: boolean;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cookie);
  app.register(swagger, {
    openapi: {
      info: { title: "Auth Scaffold API", version: "0.1.0" },
    },
    transform: jsonSchemaTransform,
  });
  if (opts.enableDocsUi) {
    app.register(swaggerUi, { routePrefix: "/docs" });
  }
  app.register(healthRoutes);

  const auth = createAuth({
    repository: opts.authRepository,
    emailSender: opts.emailSender,
    checkPwnedPassword: opts.checkPwnedPassword,
    log: app.log,
  });
  app.register(signupRoutes, { auth });
  app.register(resendCodeRoutes, { auth });
  app.register(verifyCodeRoutes, { auth });
  app.register(loginRoutes, { auth });

  return app;
}
