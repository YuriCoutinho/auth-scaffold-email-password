import type { FastifyServerOptions } from "fastify";
import type { Env } from "./config/env.js";
import type { AuthRepository } from "./plugins/app/auth/repository.js";
import type { EmailSender } from "./plugins/app/email/sender.js";
import type { CheckPwnedPassword } from "./plugins/app/pwned-password/checker.js";

export interface AppOptions {
  config: Env;
  logger?: FastifyServerOptions["logger"];
  authRepository?: AuthRepository;
  emailSender?: EmailSender;
  checkPwnedPassword?: CheckPwnedPassword;
}
