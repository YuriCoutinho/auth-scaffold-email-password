import { vi } from "vitest";
import type { AppOptions } from "../../src/app-options.js";
import type { Env } from "../../src/config/env.js";
import { createInMemoryAuthRepository } from "./auth/in-memory-repository.js";

// Never reaches a server: postgres.js only connects on the first query.
export const TEST_ENV: Env = {
  DATABASE_URL: "postgres://localhost:5432/test",
  PORT: 0,
  NODE_ENV: "test",
  EMAIL_DRIVER: "fake",
};

export function makeAppOptions(
  overrides: Partial<AppOptions> = {},
): AppOptions {
  return {
    config: TEST_ENV,
    authRepository: createInMemoryAuthRepository(),
    emailSender: {
      send: vi.fn().mockResolvedValue({ providerMessageId: "msg-1" }),
    },
    checkPwnedPassword: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}
