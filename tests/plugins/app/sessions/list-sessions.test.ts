import { describe, expect, it, vi } from "vitest";
import { createListSessionsService } from "../../../../src/plugins/app/sessions/list-sessions.js";

const NOW = new Date("2026-01-10T00:00:00.000Z");

function makeRepo(records: Array<Record<string, unknown>>) {
  return { listActiveUserSessions: vi.fn().mockResolvedValue(records) };
}

describe("listSessions", () => {
  it("asks the repository for the active sessions of the user at the current time", async () => {
    const repo = makeRepo([]);
    const { listSessions } = createListSessionsService({
      repo: repo as never,
      now: () => NOW,
    });

    await listSessions({ userId: 7, currentSessionId: 1 });

    expect(repo.listActiveUserSessions).toHaveBeenCalledWith({
      userId: 7,
      now: NOW,
    });
  });

  it("returns an empty list for a user with no active session", async () => {
    const { listSessions } = createListSessionsService({
      repo: makeRepo([]) as never,
      now: () => NOW,
    });

    await expect(
      listSessions({ userId: 7, currentSessionId: 1 }),
    ).resolves.toEqual([]);
  });

  it("flags the session behind the request and no other", async () => {
    const repo = makeRepo([
      {
        id: 2,
        publicId: "22222222-2222-4222-8222-222222222222",
        deviceLabel: "Chrome",
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
        expiresAt: new Date("2026-02-05T00:00:00.000Z"),
      },
      {
        id: 1,
        publicId: "11111111-1111-4111-8111-111111111111",
        deviceLabel: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    ]);
    const { listSessions } = createListSessionsService({
      repo: repo as never,
      now: () => NOW,
    });

    const result = await listSessions({ userId: 7, currentSessionId: 1 });

    expect(result).toEqual([
      {
        id: "22222222-2222-4222-8222-222222222222",
        deviceLabel: "Chrome",
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
        expiresAt: new Date("2026-02-05T00:00:00.000Z"),
        isCurrent: false,
      },
      {
        id: "11111111-1111-4111-8111-111111111111",
        deviceLabel: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2026-02-01T00:00:00.000Z"),
        isCurrent: true,
      },
    ]);
  });

  it("never lets the internal id reach the caller", async () => {
    const repo = makeRepo([
      {
        id: 42,
        publicId: "33333333-3333-4333-8333-333333333333",
        deviceLabel: null,
        createdAt: NOW,
        expiresAt: NOW,
      },
    ]);
    const { listSessions } = createListSessionsService({
      repo: repo as never,
      now: () => NOW,
    });

    const [session] = await listSessions({ userId: 7, currentSessionId: 42 });

    expect(session).not.toHaveProperty("publicId");
    expect(Object.values(session ?? {})).not.toContain(42);
  });
});
