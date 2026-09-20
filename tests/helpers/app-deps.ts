import { vi } from "vitest";
import type { AppDeps } from "../../src/app.js";
import type { Database } from "../../src/db/client.js";
import { authUsers, pendingSignups } from "../../src/db/schema.js";

export interface FakeDbOptions {
  authUserRows?: Array<{ id: number }>;
  pendingRows?: Array<{ signupSessionToken: string; expiresAt: Date }>;
}

interface Upsert {
  values: Record<string, unknown>;
  set: Record<string, unknown>;
}

export function createFakeDb(options: FakeDbOptions = {}) {
  const upserts: Upsert[] = [];
  const rowsFor = (table: unknown) =>
    table === authUsers
      ? (options.authUserRows ?? [])
      : table === pendingSignups
        ? (options.pendingRows ?? [])
        : [];

  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({ limit: async () => rowsFor(table) }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async (config: {
          set: Record<string, unknown>;
        }) => {
          upserts.push({ values, set: config.set });
        },
      }),
    }),
  };

  return { db: db as unknown as Database, upserts };
}

export function makeAppDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    db: createFakeDb().db,
    emailSender: vi.fn().mockResolvedValue(undefined),
    checkPwnedPassword: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}
