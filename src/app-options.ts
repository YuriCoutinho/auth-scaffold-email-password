import type { FastifyServerOptions } from "fastify";
import type { Env } from "./config/env.js";
import type { AuthRepository } from "./plugins/app/auth/repository.js";
import type { CredentialThrottleRepository } from "./plugins/app/credential-throttle/repository.js";
import type { EmailSender } from "./plugins/app/email/sender.js";
import type { CheckPwnedPassword } from "./plugins/app/pwned-password/checker.js";
import type { SessionRepository } from "./plugins/app/sessions/repository.js";

export interface AppOptions {
  config: Env;
  logger?: FastifyServerOptions["logger"];
  authRepository?: AuthRepository;
  sessionRepository?: SessionRepository;
  emailSender?: EmailSender;
  checkPwnedPassword?: CheckPwnedPassword;
  credentialThrottleRepository?: CredentialThrottleRepository;
}
