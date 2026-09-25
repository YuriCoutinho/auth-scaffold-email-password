import { describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../src/db/client.js";
import { hashSessionToken } from "../../../src/lib/token-hash.js";
import { DEFAULT_TTL } from "../../../src/lib/ttl.js";
import type { ActiveSessionRecord } from "../../../src/modules/sessions/repository.js";
import { createSessionsService } from "../../../src/modules/sessions/service.js";
import {
  createInMemoryStore,
  type InMemorySeed,
} from "../../helpers/in-memory-store.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const TOKEN = "a-session-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const CURRENT = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

// The store's sessions repository factory ignores the executor it is handed,
// so any value satisfying the type stands in for a real connection.
const db = {} as Executor;

function makeService(seed: InMemorySeed = {}, now: () => Date = () => NOW) {
  const store = createInMemoryStore(seed);
  const repo = store.repositories.sessions(db);
  const service = createSessionsService({ repo, ttl: DEFAULT_TTL, now });
  return { store, repo, service };
}

describe("issue", () => {
  it("returns a token, stores only its hash and a v4 id, and expires it at createdAt + ttl", async () => {
    const { store, service } = makeService();

    const token = await service.issue({
      userId: USER_ID,
      deviceLabel: "Chrome",
    });

    expect([...store.sessions.values()]).toEqual([
      {
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        userId: USER_ID,
        tokenHash: hashSessionToken(token),
        deviceLabel: "Chrome",
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + DEFAULT_TTL.sessionSeconds * 1000),
      },
    ]);
    expect([...store.sessions.values()][0]?.tokenHash).not.toBe(token);
  });
});

describe("authenticate", () => {
  function expiringIn(seconds: number) {
    return {
      id: SESSION_ID,
      userId: USER_ID,
      tokenHash: hashSessionToken(TOKEN),
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + seconds * 1000),
    };
  }

  it("returns the user id and the session id for a live session", async () => {
    const { service } = makeService({ sessions: [expiringIn(60)] });
    expect(await service.authenticate(TOKEN)).toEqual({
      outcome: "authenticated",
      user: { id: USER_ID },
      session: { id: SESSION_ID },
    });
  });

  it("looks the session up by the hash of the token, never by the token", async () => {
    const { repo, service } = makeService({ sessions: [expiringIn(60)] });
    const spy = vi.spyOn(repo, "findSessionByTokenHash");

    await service.authenticate(TOKEN);

    expect(spy).toHaveBeenCalledWith(hashSessionToken(TOKEN));
    expect(spy).not.toHaveBeenCalledWith(TOKEN);
  });

  it.each([undefined, ""])(
    "rejects a missing cookie (%j) without touching the repository",
    async (token) => {
      const { repo, service } = makeService({ sessions: [expiringIn(60)] });
      const spy = vi.spyOn(repo, "findSessionByTokenHash");

      expect(await service.authenticate(token)).toEqual({ outcome: "invalid" });
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("rejects a token with no matching session, which is what a deleted session gets", async () => {
    const { service } = makeService();
    expect(await service.authenticate(TOKEN)).toEqual({ outcome: "invalid" });
  });

  it("rejects a session past its stored expiry", async () => {
    const { service } = makeService({ sessions: [expiringIn(-1)] });
    expect(await service.authenticate(TOKEN)).toEqual({ outcome: "invalid" });
  });

  it("rejects a session that expires exactly now", async () => {
    const { service } = makeService({ sessions: [expiringIn(0)] });
    expect(await service.authenticate(TOKEN)).toEqual({ outcome: "invalid" });
  });

  it("accepts a session one second before it expires", async () => {
    const { service } = makeService({ sessions: [expiringIn(1)] });
    expect((await service.authenticate(TOKEN)).outcome).toBe("authenticated");
  });
});

describe("endByToken", () => {
  it("deletes the session behind the hash of the token, never the token", async () => {
    const { repo, service } = makeService();
    const spy = vi.spyOn(repo, "deleteSessionByTokenHash");

    await service.endByToken(TOKEN);

    expect(spy).toHaveBeenCalledExactlyOnceWith(hashSessionToken(TOKEN));
  });

  it("does nothing without a cookie", async () => {
    const { repo, service } = makeService();
    const spy = vi.spyOn(repo, "deleteSessionByTokenHash");

    await service.endByToken(undefined);

    expect(spy).not.toHaveBeenCalled();
  });

  it("does nothing for an empty cookie", async () => {
    const { repo, service } = makeService();
    const spy = vi.spyOn(repo, "deleteSessionByTokenHash");

    await service.endByToken("");

    expect(spy).not.toHaveBeenCalled();
  });

  it("resolves for a token with no matching session", async () => {
    const { service } = makeService();
    await expect(service.endByToken("unknown-token")).resolves.toBeUndefined();
  });
});

describe("endAllOfUser", () => {
  it("always keeps the current session out of the deletion", async () => {
    const { repo, service } = makeService();
    const spy = vi.spyOn(repo, "deleteUserSessions");

    await service.endAllOfUser({ userId: USER_ID, exceptSessionId: CURRENT });

    expect(spy).toHaveBeenCalledWith({
      userId: USER_ID,
      exceptSessionId: CURRENT,
    });
  });

  it("reports how many sessions were revoked", async () => {
    const { service } = makeService({
      sessions: [
        { id: "a", userId: USER_ID, tokenHash: "a", createdAt: NOW },
        { id: "b", userId: USER_ID, tokenHash: "b", createdAt: NOW },
        { id: CURRENT, userId: USER_ID, tokenHash: "c", createdAt: NOW },
      ],
    });

    const revokedCount = await service.endAllOfUser({
      userId: USER_ID,
      exceptSessionId: CURRENT,
    });

    expect(revokedCount).toBe(2);
  });

  it("succeeds when the user has no other session to revoke", async () => {
    const { service } = makeService();
    expect(
      await service.endAllOfUser({ userId: USER_ID, exceptSessionId: CURRENT }),
    ).toBe(0);
  });
});

describe("endOne", () => {
  it("asks the repository to delete that session for that user", async () => {
    const { repo, service } = makeService();
    const spy = vi.spyOn(repo, "deleteUserSession");

    await service.endOne({ userId: USER_ID, sessionId: SESSION_ID });

    expect(spy).toHaveBeenCalledWith({ id: SESSION_ID, userId: USER_ID });
  });

  it("reports whether a session was actually deleted", async () => {
    const { service } = makeService({
      sessions: [
        { id: SESSION_ID, userId: USER_ID, tokenHash: "x", createdAt: NOW },
      ],
    });

    expect(
      await service.endOne({ userId: USER_ID, sessionId: SESSION_ID }),
    ).toBe(true);
    expect(
      await service.endOne({ userId: USER_ID, sessionId: SESSION_ID }),
    ).toBe(false);
  });

  it("revokes an expired session the sweep has not removed yet, harmlessly", async () => {
    const { store, service } = makeService({
      sessions: [
        {
          id: SESSION_ID,
          userId: USER_ID,
          tokenHash: "expired",
          createdAt: new Date(0),
        },
      ],
    });

    expect(
      await service.endOne({ userId: USER_ID, sessionId: SESSION_ID }),
    ).toBe(true);
    expect(store.sessions.size).toBe(0);
  });
});

describe("listActive", () => {
  const OTHER_RECORD: ActiveSessionRecord = {
    id: OTHER,
    deviceLabel: "Chrome",
    createdAt: new Date("2026-01-05T00:00:00.000Z"),
    expiresAt: new Date("2026-02-04T00:00:00.000Z"),
  };
  const CURRENT_RECORD: ActiveSessionRecord = {
    id: CURRENT,
    deviceLabel: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2026-01-31T00:00:00.000Z"),
  };

  it("asks for the sessions of the user still active now", async () => {
    const { repo, service } = makeService();
    const spy = vi.spyOn(repo, "listUserSessions");

    await service.listActive({ userId: USER_ID, currentSessionId: CURRENT });

    expect(spy).toHaveBeenCalledWith({ userId: USER_ID, activeAt: NOW });
  });

  it("returns an empty list for a user with no live session", async () => {
    const { service } = makeService();
    await expect(
      service.listActive({ userId: USER_ID, currentSessionId: CURRENT }),
    ).resolves.toEqual([]);
  });

  it("returns the stored expiry and flags only the current session", async () => {
    const { service } = makeService(
      {
        sessions: [
          {
            id: OTHER_RECORD.id,
            userId: USER_ID,
            tokenHash: "other",
            deviceLabel: OTHER_RECORD.deviceLabel,
            createdAt: OTHER_RECORD.createdAt,
            expiresAt: OTHER_RECORD.expiresAt,
          },
          {
            id: CURRENT_RECORD.id,
            userId: USER_ID,
            tokenHash: "current",
            deviceLabel: CURRENT_RECORD.deviceLabel,
            createdAt: CURRENT_RECORD.createdAt,
            expiresAt: CURRENT_RECORD.expiresAt,
          },
        ],
      },
      () => new Date("2026-01-10T00:00:00.000Z"),
    );

    const result = await service.listActive({
      userId: USER_ID,
      currentSessionId: CURRENT,
    });

    expect(result).toEqual([
      { ...OTHER_RECORD, isCurrent: false },
      { ...CURRENT_RECORD, isCurrent: true },
    ]);
  });
});

describe("purgeExpired", () => {
  it("deletes only the sessions expired at or before the given instant, and keeps the rest", async () => {
    const { store, service } = makeService({
      sessions: [
        {
          id: "expired",
          userId: USER_ID,
          tokenHash: "expired",
          createdAt: new Date(0),
          expiresAt: NOW,
        },
        {
          id: "live",
          userId: USER_ID,
          tokenHash: "live",
          createdAt: NOW,
          expiresAt: new Date(NOW.getTime() + 60_000),
        },
      ],
    });

    const purgedCount = await service.purgeExpired(NOW);

    expect(purgedCount).toBe(1);
    expect([...store.sessions.keys()]).toEqual(["live"]);
  });
});
