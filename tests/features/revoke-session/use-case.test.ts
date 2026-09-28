import { describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../src/db/client.js";
import { createRevokeSession } from "../../../src/features/revoke-session/use-case.js";
import { DEFAULT_TTL } from "../../../src/lib/ttl.js";
import { createSessionsService } from "../../../src/modules/sessions/service.js";
import {
  createInMemoryStore,
  type InMemorySeed,
} from "../../helpers/in-memory-store.js";

const USER = "11111111-1111-4111-8111-111111111111";
const SESSION = "33333333-3333-4333-8333-333333333333";

// The store's sessions repository factory ignores the executor it is handed,
// so any value satisfying the type stands in for a real connection.
const db = {} as Executor;

function makeRevokeSession(seed: InMemorySeed = {}) {
  const store = createInMemoryStore(seed);
  const sessions = createSessionsService({
    repo: store.repositories.sessions(db),
    ttl: DEFAULT_TTL,
  });
  const log = { info: vi.fn() };
  return { store, log, revokeSession: createRevokeSession({ sessions, log }) };
}

describe("revokeSession", () => {
  it("deletes that session for that user", async () => {
    const { store, revokeSession } = makeRevokeSession({
      sessions: [{ id: SESSION, userId: USER, tokenHash: "token" }],
    });

    await revokeSession({ userId: USER, sessionId: SESSION });

    expect(store.sessions.has(SESSION)).toBe(false);
  });

  it("logs the revocation with the user and the session, and never a token", async () => {
    const { log, revokeSession } = makeRevokeSession({
      sessions: [{ id: SESSION, userId: USER, tokenHash: "token" }],
    });

    await revokeSession({ userId: USER, sessionId: SESSION });

    expect(log.info).toHaveBeenCalledWith(
      { userId: USER, sessionId: SESSION },
      "session revoked",
    );
  });

  it("stays silent and resolves the same way when nothing was deleted", async () => {
    const { log, revokeSession } = makeRevokeSession();

    await expect(
      revokeSession({ userId: USER, sessionId: SESSION }),
    ).resolves.toBeUndefined();

    expect(log.info).not.toHaveBeenCalled();
  });

  it("revokes an expired session the sweep has not removed yet, harmlessly", async () => {
    const { store, revokeSession } = makeRevokeSession({
      sessions: [
        {
          id: SESSION,
          userId: USER,
          tokenHash: "expired",
          createdAt: new Date(0),
        },
      ],
    });

    await expect(
      revokeSession({ userId: USER, sessionId: SESSION }),
    ).resolves.toBeUndefined();

    expect(store.sessions.size).toBe(0);
  });

  it("works without a logger", async () => {
    const store = createInMemoryStore({
      sessions: [{ id: SESSION, userId: USER, tokenHash: "token" }],
    });
    const sessions = createSessionsService({
      repo: store.repositories.sessions(db),
      ttl: DEFAULT_TTL,
    });
    const revokeSession = createRevokeSession({ sessions });

    await expect(
      revokeSession({ userId: USER, sessionId: SESSION }),
    ).resolves.toBeUndefined();
  });
});
