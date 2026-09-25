import { describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../src/db/client.js";
import { createLogoutAll } from "../../../src/features/logout-all/use-case.js";
import { DEFAULT_TTL } from "../../../src/lib/ttl.js";
import { createSessionsService } from "../../../src/modules/sessions/service.js";
import {
  createInMemoryStore,
  type InMemorySeed,
} from "../../helpers/in-memory-store.js";

const USER = "11111111-1111-4111-8111-111111111111";
const CURRENT = "22222222-2222-4222-8222-222222222222";

// The store's sessions repository factory ignores the executor it is handed,
// so any value satisfying the type stands in for a real connection.
const db = {} as Executor;

function makeLogoutAll(seed: InMemorySeed = {}) {
  const store = createInMemoryStore(seed);
  const sessions = createSessionsService({
    repo: store.repositories.sessions(db),
    ttl: DEFAULT_TTL,
  });
  const log = { info: vi.fn() };
  return { store, log, logoutAll: createLogoutAll({ sessions, log }) };
}

describe("logoutAll", () => {
  it("always keeps the current session out of the deletion", async () => {
    const { store, logoutAll } = makeLogoutAll({
      sessions: [
        { id: CURRENT, userId: USER, tokenHash: "current" },
        { id: "other", userId: USER, tokenHash: "other" },
      ],
    });

    await logoutAll({ userId: USER, currentSessionId: CURRENT });

    expect([...store.sessions.keys()]).toEqual([CURRENT]);
  });

  it("reports how many sessions were revoked", async () => {
    const { logoutAll } = makeLogoutAll({
      sessions: [
        { id: CURRENT, userId: USER, tokenHash: "current" },
        { id: "a", userId: USER, tokenHash: "a" },
        { id: "b", userId: USER, tokenHash: "b" },
      ],
    });

    const result = await logoutAll({
      userId: USER,
      currentSessionId: CURRENT,
    });

    expect(result).toEqual({ revokedCount: 2 });
  });

  it("succeeds when the user has no other session to revoke", async () => {
    const { logoutAll } = makeLogoutAll({
      sessions: [{ id: CURRENT, userId: USER, tokenHash: "current" }],
    });

    const result = await logoutAll({
      userId: USER,
      currentSessionId: CURRENT,
    });

    expect(result).toEqual({ revokedCount: 0 });
  });

  it("logs the event with the count, and never a token", async () => {
    const { log, logoutAll } = makeLogoutAll({
      sessions: [
        { id: CURRENT, userId: USER, tokenHash: "current" },
        { id: "a", userId: USER, tokenHash: "a" },
      ],
    });

    await logoutAll({ userId: USER, currentSessionId: CURRENT });

    expect(log.info).toHaveBeenCalledWith(
      { userId: USER, revokedCount: 1 },
      "all sessions revoked",
    );
  });

  it("works without a logger", async () => {
    const store = createInMemoryStore({
      sessions: [{ id: CURRENT, userId: USER, tokenHash: "current" }],
    });
    const sessions = createSessionsService({
      repo: store.repositories.sessions(db),
      ttl: DEFAULT_TTL,
    });
    const logoutAll = createLogoutAll({ sessions });

    await expect(
      logoutAll({ userId: USER, currentSessionId: CURRENT }),
    ).resolves.toEqual({ revokedCount: 0 });
  });
});
