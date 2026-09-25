import { vi } from "vitest";
import type { AppOptions } from "../../src/app-options.js";
import type { Env } from "../../src/config/env.js";
import type { RateLimitOverrides } from "../../src/lib/rate-limit.js";
import type { RetentionRepository } from "../../src/plugins/app/retention/repository.js";
import { FakeEmailSender } from "../../src/plugins/email/drivers/fake.js";
import { createInMemoryStore, type InMemoryStore } from "./in-memory-store.js";

export const TEST_HMAC_SECRET = "test-hmac-secret-with-32-characters!";

// Never reaches a server: postgres.js only connects on the first query.
export const TEST_ENV: Env = {
  DATABASE_URL: "postgres://localhost:5432/test",
  PORT: 0,
  NODE_ENV: "test",
  EMAIL_DRIVER: "fake",
  HMAC_SECRET: TEST_HMAC_SECRET,
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

// The sweep timer never fires within a test, but the default adapter would
// still be wired to the database, so tests get a port that touches nothing.
export const noopRetentionRepository: RetentionRepository = {
  purge: async () => ({
    sessions: 0,
    verificationCodes: 0,
    unverifiedUsers: 0,
    throttleTrails: 0,
  }),
};

// The in-memory store backs every legacy port over the same maps, so a test
// that overrides the store gets the same rows on both sides instead of the
// route reading one store while the session hook reads another.
type AppOptionsOverrides = Partial<AppOptions> & {
  store?: InMemoryStore;
};

export function makeAppOptions(
  overrides: AppOptionsOverrides = {},
): AppOptions {
  const { store: storeOverride, ...rest } = overrides;
  const store = storeOverride ?? createInMemoryStore();
  return {
    config: TEST_ENV,
    logger: false,
    emailSender: new FakeEmailSender(),
    checkPwnedPassword: vi.fn().mockResolvedValue(false),
    retentionRepository: noopRetentionRepository,
    transaction: store.transaction,
    authRepository: store.legacy,
    sessionRepository: store.legacy,
    credentialThrottleRepository: store.legacy,
    ...rest,
    rateLimit: { ...TEST_RATE_LIMITS, ...overrides.rateLimit },
  };
}
