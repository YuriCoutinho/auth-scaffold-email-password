import { vi } from "vitest";
import type { AppDeps } from "../../src/app.js";
import type { Database } from "../../src/db/client.js";
import { authUsers, pendingSignups } from "../../src/db/schema.js";

export interface FakeDbOptions {
  authUserRows?: Array<{
    id: number;
    publicId?: string;
    passwordHash?: string;
  }>;
  pendingRows?: Array<{
    signupSessionToken?: string;
    expiresAt: Date;
    id?: number;
    email?: string;
    passwordHash?: string;
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
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const deletes: unknown[] = [];
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
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: (config: { set: Record<string, unknown> }) => ({
          returning: async () => {
            upserts.push({ values, set: config.set });
            return [{ id: 1 }];
          },
        }),
        returning: async () => {
          inserts.push({ table, values });
          return [{ id: 1, publicId: "00000000-0000-0000-0000-000000000001" }];
        },
        // biome-ignore lint/suspicious/noThenProperty: intentionally thenable so plain `await db.insert(...).values(...)` works
        then: (
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) =>
          Promise.resolve()
            .then(() => {
              inserts.push({ table, values });
            })
            .then(resolve, reject),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async () => {
          updates.push(set);
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        deletes.push(table);
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };

  return { db: db as unknown as Database, upserts, updates, inserts, deletes };
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
