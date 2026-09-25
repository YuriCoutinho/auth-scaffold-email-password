import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppOptions } from "../app-options.js";
import type { Database, Transaction } from "../db/client.js";

export type TransactionRunner = <T>(
  work: (tx: Transaction) => Promise<T>,
) => Promise<T>;

// Thrown to undo a transaction while still handing the caller a result, for
// the flows where losing a race is an answer and not an error.
export class Rollback<T> {
  constructor(readonly value: T) {}
}

export function rollback<T>(value: T): never {
  throw new Rollback(value);
}

export function createDrizzleTransactionRunner(
  db: Database,
): TransactionRunner {
  return async (work) => {
    try {
      return await db.transaction(work);
    } catch (error) {
      if (error instanceof Rollback) {
        return error.value;
      }
      throw error;
    }
  };
}

declare module "fastify" {
  interface FastifyInstance {
    transaction: TransactionRunner;
  }
}

const plugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  fastify.decorate(
    "transaction",
    opts.transaction ?? createDrizzleTransactionRunner(fastify.db),
  );
};

export default fp(plugin, { name: "transaction", dependencies: ["database"] });
