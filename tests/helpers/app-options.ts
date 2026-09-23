import { vi } from "vitest";
import type { AppOptions } from "../../src/app-options.js";
import type { Env } from "../../src/config/env.js";
import type { AuthRepository } from "../../src/plugins/app/auth/repository.js";
import { FakeEmailSender } from "../../src/plugins/app/email/drivers/fake.js";
import type { SessionRepository } from "../../src/plugins/app/sessions/repository.js";
import { createInMemoryAuthRepository } from "./auth/in-memory-repository.js";
import {
  createInMemoryEmailOutboxRepository,
  type InMemoryEmailOutboxRepository,
} from "./email-outbox/in-memory-repository.js";

// Never reaches a server: postgres.js only connects on the first query.
export const TEST_ENV: Env = {
  DATABASE_URL: "postgres://localhost:5432/test",
  PORT: 0,
  NODE_ENV: "test",
  EMAIL_DRIVER: "fake",
};

// The in-memory helper implements both ports over one store, so a test that
// overrides the repository gets the same rows on both sides instead of the
// route reading one store while the session hook reads another.
type AppOptionsOverrides = Partial<
  Omit<AppOptions, "authRepository" | "emailOutboxRepository">
> & {
  authRepository?: AuthRepository & SessionRepository;
  emailOutboxRepository?: InMemoryEmailOutboxRepository;
};

export function makeAppOptions(
  overrides: AppOptionsOverrides = {},
): AppOptions & { emailOutboxRepository: InMemoryEmailOutboxRepository } {
  const authRepository =
    overrides.authRepository ?? createInMemoryAuthRepository();
  const emailOutboxRepository =
    overrides.emailOutboxRepository ?? createInMemoryEmailOutboxRepository();
  return {
    config: TEST_ENV,
    logger: false,
    emailSender: new FakeEmailSender(),
    checkPwnedPassword: vi.fn().mockResolvedValue(false),
    // A polling loop under the test runner holds the event loop open and leaks
    // across suites, so no test starts the worker unless it asks for it.
    startEmailWorker: false,
    ...overrides,
    authRepository,
    sessionRepository: overrides.sessionRepository ?? authRepository,
    emailOutboxRepository,
  };
}
