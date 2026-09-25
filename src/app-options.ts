import type { FastifyServerOptions } from "fastify";
import type { Env } from "./config/env.js";
import type { Executor } from "./db/client.js";
import type { RateLimitOverrides } from "./lib/rate-limit.js";
import type { TtlPolicy } from "./lib/ttl.js";
import type { CredentialThrottleRepository } from "./modules/credential-throttle/repository.js";
import type { OtpRepository } from "./modules/otp/repository.js";
import type { SessionsRepository } from "./modules/sessions/repository.js";
import type { UsersRepository } from "./modules/users/repository.js";
import type { RetentionRepository } from "./plugins/app/retention/repository.js";
import type { EmailSender } from "./plugins/email/sender.js";
import type { CheckPwnedPassword } from "./plugins/pwned-password/checker.js";
import type { TransactionRunner } from "./plugins/transaction.js";

// One factory per module, so a test overrides only the repository the case
// under test touches.
export interface RepositoryFactories {
  users: (executor: Executor) => UsersRepository;
  sessions: (executor: Executor) => SessionsRepository;
  otp: (executor: Executor) => OtpRepository;
  credentialThrottle: (executor: Executor) => CredentialThrottleRepository;
}

export interface AppOptions {
  config: Env;
  logger?: FastifyServerOptions["logger"];
  emailSender?: EmailSender;
  checkPwnedPassword?: CheckPwnedPassword;
  retentionRepository?: RetentionRepository;
  repositories?: Partial<RepositoryFactories>;
  transaction?: TransactionRunner;
  rateLimit?: RateLimitOverrides;
  ttl?: Partial<TtlPolicy>;
}
