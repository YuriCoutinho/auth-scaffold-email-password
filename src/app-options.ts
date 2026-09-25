import type { FastifyServerOptions } from "fastify";
import type { Env } from "./config/env.js";
import type { Executor } from "./db/client.js";
import type { RateLimitOverrides } from "./lib/rate-limit.js";
import type { TtlPolicy } from "./lib/ttl.js";
import type { SessionsRepository } from "./modules/sessions/repository.js";
import type { AuthRepository } from "./plugins/app/auth/repository.js";
import type { CredentialThrottleRepository } from "./plugins/app/credential-throttle/repository.js";
import type { RetentionRepository } from "./plugins/app/retention/repository.js";
import type { SessionRepository } from "./plugins/app/sessions/repository.js";
import type { EmailSender } from "./plugins/email/sender.js";
import type { CheckPwnedPassword } from "./plugins/pwned-password/checker.js";
import type { TransactionRunner } from "./plugins/transaction.js";

// Each module adds its entry here as it migrates off the legacy ports below,
// so a test overrides only the repository the case under test touches.
export interface RepositoryFactories {
  sessions: (executor: Executor) => SessionsRepository;
}

export interface AppOptions {
  config: Env;
  logger?: FastifyServerOptions["logger"];
  authRepository?: AuthRepository;
  sessionRepository?: SessionRepository;
  emailSender?: EmailSender;
  checkPwnedPassword?: CheckPwnedPassword;
  credentialThrottleRepository?: CredentialThrottleRepository;
  retentionRepository?: RetentionRepository;
  repositories?: Partial<RepositoryFactories>;
  transaction?: TransactionRunner;
  rateLimit?: RateLimitOverrides;
  ttl?: Partial<TtlPolicy>;
}
