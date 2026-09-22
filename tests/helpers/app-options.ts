import { vi } from "vitest";
import type { AppOptions } from "../../src/app-options.js";
import { createInMemoryAuthRepository } from "./in-memory-auth-repository.js";

export function makeAppOptions(
  overrides: Partial<AppOptions> = {},
): AppOptions {
  return {
    authRepository: createInMemoryAuthRepository(),
    emailSender: {
      send: vi.fn().mockResolvedValue({ providerMessageId: "msg-1" }),
    },
    checkPwnedPassword: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}
