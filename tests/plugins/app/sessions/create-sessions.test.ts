import { describe, expect, it } from "vitest";
import { createSessions } from "../../../../src/plugins/app/sessions/create-sessions.js";
import { createInMemoryAuthRepository } from "../../../helpers/auth/in-memory-repository.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const USER = "11111111-1111-4111-8111-111111111111";

describe("createSessions", () => {
  it("exposes every session flow over one repository", async () => {
    const sessions = createSessions({
      repository: createInMemoryAuthRepository(),
    });

    await expect(sessions.logout("unknown-token")).resolves.toBeUndefined();
    expect(
      await sessions.logoutAll({ userId: USER, currentSessionId: "s-1" }),
    ).toEqual({ revokedCount: 0 });
    expect(
      await sessions.listSessions({ userId: USER, currentSessionId: "s-1" }),
    ).toEqual([]);
    await expect(
      sessions.revokeSession({ userId: USER, sessionId: "s-1" }),
    ).resolves.toBeUndefined();
  });

  it("lists sessions against their stored expiry and the injected clock", async () => {
    const sessions = createSessions({
      repository: createInMemoryAuthRepository({
        sessions: [
          {
            id: "live",
            userId: USER,
            tokenHash: "live",
            createdAt: new Date(NOW.getTime() - 30_000),
            expiresAt: new Date(NOW.getTime() + 30_000),
          },
          {
            id: "expired",
            userId: USER,
            tokenHash: "expired",
            createdAt: new Date(NOW.getTime() - 60_000),
            expiresAt: NOW,
          },
        ],
      }),
      now: () => NOW,
    });

    const listed = await sessions.listSessions({
      userId: USER,
      currentSessionId: "live",
    });

    expect(listed).toEqual([
      {
        id: "live",
        deviceLabel: null,
        createdAt: new Date(NOW.getTime() - 30_000),
        expiresAt: new Date(NOW.getTime() + 30_000),
        isCurrent: true,
      },
    ]);
  });
});
