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
import type { Database } from "./db/client.js";
import { createSignupRepo } from "./db/signup-repo.js";
import type { CheckPwnedPassword } from "./lib/pwned-password.js";
import { signupRoutes } from "./routes/auth/signup.js";
import { healthRoutes } from "./routes/health.js";
import type { EmailSender } from "./services/email-sender.js";
import { createSignupService } from "./services/signup.js";

export interface AppDeps {
  db: Database;
  emailSender: EmailSender;
  checkPwnedPassword: CheckPwnedPassword;
  enableDocsUi?: boolean;
}

export function buildApp(deps: AppDeps): FastifyInstance {
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
  if (deps.enableDocsUi) {
    app.register(swaggerUi, { routePrefix: "/docs" });
  }
  app.register(healthRoutes);

  const signupService = createSignupService({
    repo: createSignupRepo(deps.db),
    emailSender: deps.emailSender,
    checkPwnedPassword: deps.checkPwnedPassword,
    log: app.log,
  });
  app.register(signupRoutes, { signupService });

  return app;
}
