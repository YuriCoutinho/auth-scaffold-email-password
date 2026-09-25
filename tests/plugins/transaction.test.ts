import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/db/client.js";
import {
  createDrizzleTransactionRunner,
  rollback,
} from "../../src/plugins/transaction.js";

function fakeDb() {
  const tx = {};
  const transaction = vi.fn(async (work: (t: unknown) => Promise<unknown>) =>
    work(tx),
  );
  return { db: { transaction } as unknown as Database, tx, transaction };
}

describe("createDrizzleTransactionRunner", () => {
  it("hands the work the transaction and returns its result", async () => {
    const { db, tx } = fakeDb();
    const run = createDrizzleTransactionRunner(db);
    await expect(run(async (t) => (t === tx ? "same" : "other"))).resolves.toBe(
      "same",
    );
  });

  it("turns a rollback into the value it carries", async () => {
    const { db } = fakeDb();
    const run = createDrizzleTransactionRunner(db);
    await expect(run(async () => rollback(false))).resolves.toBe(false);
  });

  it("rethrows any other error", async () => {
    const { db } = fakeDb();
    const run = createDrizzleTransactionRunner(db);
    await expect(
      run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
