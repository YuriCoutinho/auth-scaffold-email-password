import { describe, expect, it } from "vitest";
import type { Executor } from "../../../src/db/client.js";
import { createListSessions } from "../../../src/features/list-sessions/use-case.js";
import { DEFAULT_TTL } from "../../../src/lib/ttl.js";
import { createSessionsService } from "../../../src/modules/sessions/service.js";
import {
  createInMemoryStore,
  type InMemorySeed,
} from "../../helpers/in-memory-store.js";

const NOW = new Date("2026-01-10T00:00:00.000Z");
const USER = "11111111-1111-4111-8111-111111111111";
const CURRENT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

// The store's sessions repository factory ignores the executor it is handed,
// so any value satisfying the type stands in for a real connection.
const db = {} as Executor;

function makeListSessions(seed: InMemorySeed = {}) {
  const store = createInMemoryStore(seed);
  const sessions = createSessionsService({
    repo: store.repositories.sessions(db),
    ttl: DEFAULT_TTL,
    now: () => NOW,
  });
  return { store, listSessions: createListSessions({ sessions }) };
}

describe("listSessions", () => {
  it("returns an empty list for a user with no live session", async () => {
    const { listSessions } = makeListSessions();

    await expect(
      listSessions({ userId: USER, currentSessionId: CURRENT }),
    ).resolves.toEqual([]);
  });

  it("returns the stored expiry and flags only the current session", async () => {
    const { listSessions } = makeListSessions({
      sessions: [
        {
          id: OTHER,
          userId: USER,
          tokenHash: "other",
          deviceLabel: "Chrome",
          createdAt: new Date("2026-01-05T00:00:00.000Z"),
          expiresAt: new Date("2026-02-04T00:00:00.000Z"),
        },
        {
          id: CURRENT,
          userId: USER,
          tokenHash: "current",
          deviceLabel: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          expiresAt: new Date("2026-01-31T00:00:00.000Z"),
        },
      ],
    });

    const result = await listSessions({
      userId: USER,
      currentSessionId: CURRENT,
    });

    expect(result).toEqual([
      {
        id: OTHER,
        deviceLabel: "Chrome",
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
        expiresAt: new Date("2026-02-04T00:00:00.000Z"),
        isCurrent: false,
      },
      {
        id: CURRENT,
        deviceLabel: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2026-01-31T00:00:00.000Z"),
        isCurrent: true,
      },
    ]);
  });

  it("leaves out a session that already expired as of now", async () => {
    const { listSessions } = makeListSessions({
      sessions: [
        {
          id: OTHER,
          userId: USER,
          tokenHash: "other",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          expiresAt: new Date("2026-01-05T00:00:00.000Z"),
        },
      ],
    });

    await expect(
      listSessions({ userId: USER, currentSessionId: CURRENT }),
    ).resolves.toEqual([]);
  });

  it("never returns a session belonging to another user", async () => {
    const otherUser = "44444444-4444-4444-8444-444444444444";
    const { listSessions } = makeListSessions({
      sessions: [
        { id: CURRENT, userId: USER, tokenHash: "current" },
        { id: OTHER, userId: otherUser, tokenHash: "other" },
      ],
    });

    const result = await listSessions({
      userId: USER,
      currentSessionId: CURRENT,
    });

    expect(result.map((session) => session.id)).toEqual([CURRENT]);
  });
});
