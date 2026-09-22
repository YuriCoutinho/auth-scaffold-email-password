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
import type { CheckPwnedPassword } from "./lib/pwned-password.js";
import type { AuthRepository } from "./plugins/app/auth/auth-repository.js";
import { loginRoutes } from "./routes/auth/login.js";
import { resendCodeRoutes } from "./routes/auth/resend-code.js";
import { signupRoutes } from "./routes/auth/signup.js";
import { verifyCodeRoutes } from "./routes/auth/verify-code.js";
import { healthRoutes } from "./routes/health.js";
import type { EmailSender } from "./services/email-sender.js";
import { createLoginService } from "./services/login.js";
import { createResendCodeService } from "./services/resend-code.js";
import { createSignupService } from "./services/signup.js";
import { createVerifyCodeService } from "./services/verify-code.js";

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

  const repo = opts.authRepository;
  const signupService = createSignupService({
    repo,
    emailSender: opts.emailSender,
    checkPwnedPassword: opts.checkPwnedPassword,
    log: app.log,
  });
  const resendCodeService = createResendCodeService({
    repo,
    emailSender: opts.emailSender,
    log: app.log,
  });
  const verifyCodeService = createVerifyCodeService({ repo, log: app.log });
  const loginService = createLoginService({ repo, log: app.log });
  app.register(signupRoutes, { signupService });
  app.register(resendCodeRoutes, { resendCodeService });
  app.register(verifyCodeRoutes, { verifyCodeService });
  app.register(loginRoutes, { loginService });

  return app;
}
