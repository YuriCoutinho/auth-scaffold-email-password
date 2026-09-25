import { describe, expect, it, vi } from "vitest";
import { createListSessionsService } from "../../../../src/plugins/app/sessions/list-sessions.js";
import type { ActiveSessionRecord } from "../../../../src/plugins/app/sessions/repository.js";

const NOW = new Date("2026-01-10T00:00:00.000Z");
const USER = "11111111-1111-4111-8111-111111111111";
const CURRENT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

function makeService(records: ActiveSessionRecord[]) {
  const repo = { listUserSessions: vi.fn().mockResolvedValue(records) };
  const { listSessions } = createListSessionsService({
    repo,
    now: () => NOW,
  });
  return { repo, listSessions };
}

describe("listSessions", () => {
  it("asks for the sessions of the user still active now", async () => {
    const { repo, listSessions } = makeService([]);

    await listSessions({ userId: USER, currentSessionId: CURRENT });

    expect(repo.listUserSessions).toHaveBeenCalledWith({
      userId: USER,
      activeAt: NOW,
    });
  });

  it("returns an empty list for a user with no live session", async () => {
    const { listSessions } = makeService([]);

    await expect(
      listSessions({ userId: USER, currentSessionId: CURRENT }),
    ).resolves.toEqual([]);
  });

  it("returns the stored expiry and flags only the current session", async () => {
    const { listSessions } = makeService([
      {
        id: OTHER,
        deviceLabel: "Chrome",
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
        expiresAt: new Date("2026-02-04T00:00:00.000Z"),
      },
      {
        id: CURRENT,
        deviceLabel: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2026-01-31T00:00:00.000Z"),
      },
    ]);

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
});
