import { vi } from "vitest";
import type { AppDeps } from "../../src/app.js";
import type { Database } from "../../src/db/client.js";
import { authUsers, pendingSignups } from "../../src/db/schema.js";

export interface FakeDbOptions {
  authUserRows?: Array<{ id: number }>;
  pendingRows?: Array<{
    signupSessionToken?: string;
    expiresAt: Date;
    id?: number;
    email?: string;
    codeHash?: string;
    codeAttempts?: number;
    lastSentAt?: Date;
    codeSendCount?: number;
  }>;
}

interface Upsert {
  values: Record<string, unknown>;
  set: Record<string, unknown>;
}

export function createFakeDb(options: FakeDbOptions = {}) {
  const upserts: Upsert[] = [];
  const updates: Array<Record<string, unknown>> = [];
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
        onConflictDoUpdate: (config: { set: Record<string, unknown> }) => ({
          returning: async () => {
            upserts.push({ values, set: config.set });
            return [{ id: 1 }];
          },
        }),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async () => {
          updates.push(set);
        },
      }),
    }),
  };

  return { db: db as unknown as Database, upserts, updates };
}

export function makeAppDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    db: createFakeDb().db,
    emailSender: {
      send: vi.fn().mockResolvedValue({ providerMessageId: "msg-1" }),
    },
    checkPwnedPassword: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}
