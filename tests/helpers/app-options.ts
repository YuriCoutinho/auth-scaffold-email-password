import { vi } from "vitest";
import type { AppOptions } from "../../src/app-options.js";
import type { Env } from "../../src/config/env.js";
import type { RateLimitOverrides } from "../../src/lib/rate-limit.js";
import type { AuthRepository } from "../../src/plugins/app/auth/repository.js";
import { FakeEmailSender } from "../../src/plugins/app/email/drivers/fake.js";
import type { SessionRepository } from "../../src/plugins/app/sessions/repository.js";
import { createInMemoryAuthRepository } from "./auth/in-memory-repository.js";
import { createInMemoryCredentialThrottleRepository } from "./credential-throttle/in-memory-repository.js";

// Never reaches a server: postgres.js only connects on the first query.
export const TEST_ENV: Env = {
  DATABASE_URL: "postgres://localhost:5432/test",
  PORT: 0,
  NODE_ENV: "test",
  EMAIL_DRIVER: "fake",
};

// The limiter runs in tests exactly as it runs in production; only the ceiling
// moves, so a test that wants a 429 lowers it instead of disabling the plugin.
const TEST_RATE_LIMITS: RateLimitOverrides = {
  global: { max: 10_000, timeWindow: "1 minute" },
  login: { max: 10_000, timeWindow: "1 minute" },
  changePassword: { max: 10_000, timeWindow: "1 minute" },
  signup: { max: 10_000, timeWindow: "1 minute" },
  forgotPassword: { max: 10_000, timeWindow: "1 minute" },
  resendCode: { max: 10_000, timeWindow: "1 minute" },
  verifyCode: { max: 10_000, timeWindow: "1 minute" },
  resetPassword: { max: 10_000, timeWindow: "1 minute" },
};

// The in-memory helper implements both ports over one store, so a test that
// overrides the repository gets the same rows on both sides instead of the
// route reading one store while the session hook reads another.
type AppOptionsOverrides = Partial<Omit<AppOptions, "authRepository">> & {
  authRepository?: AuthRepository & SessionRepository;
};

export function makeAppOptions(
  overrides: AppOptionsOverrides = {},
): AppOptions {
  const authRepository =
    overrides.authRepository ?? createInMemoryAuthRepository();
  return {
    config: TEST_ENV,
    logger: false,
    emailSender: new FakeEmailSender(),
    checkPwnedPassword: vi.fn().mockResolvedValue(false),
    credentialThrottleRepository: createInMemoryCredentialThrottleRepository(),
    ...overrides,
    authRepository,
    sessionRepository: overrides.sessionRepository ?? authRepository,
    rateLimit: { ...TEST_RATE_LIMITS, ...overrides.rateLimit },
  };
}
