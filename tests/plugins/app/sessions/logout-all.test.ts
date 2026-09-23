import { describe, expect, it, vi } from "vitest";
import { createLogoutAllService } from "../../../../src/plugins/app/sessions/logout-all.js";

const NOW = new Date("2026-09-23T12:00:00Z");

function makeDeps(revokedCount = 2) {
  return {
    repo: {
      revokeAllUserSessions: vi.fn().mockResolvedValue({ revokedCount }),
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => NOW,
  };
}

describe("logoutAll", () => {
  it("always keeps the current session out of the revocation", async () => {
    const deps = makeDeps();

    await createLogoutAllService(deps).logoutAll({
      userId: 7,
      currentSessionId: 3,
    });

    expect(deps.repo.revokeAllUserSessions).toHaveBeenCalledWith({
      userId: 7,
      revokedAt: NOW,
      revokedReason: "logout_all",
      exceptSessionId: 3,
    });
  });

  it("reports how many sessions were revoked", async () => {
    const result = await createLogoutAllService(makeDeps(3)).logoutAll({
      userId: 7,
      currentSessionId: 3,
    });

    expect(result).toEqual({ revokedCount: 3 });
  });

  it("succeeds when the user has no other session to revoke", async () => {
    const result = await createLogoutAllService(makeDeps(0)).logoutAll({
      userId: 7,
      currentSessionId: 3,
    });

    expect(result).toEqual({ revokedCount: 0 });
  });

  it("logs the event with the count, and never a token", async () => {
    const deps = makeDeps(5);

    await createLogoutAllService(deps).logoutAll({
      userId: 7,
      currentSessionId: 3,
    });

    expect(deps.log.info).toHaveBeenCalledWith(
      { userId: 7, revokedCount: 5 },
      "all sessions revoked",
    );
  });

  it("works without a logger", async () => {
    const { log: _log, ...deps } = makeDeps();

    await expect(
      createLogoutAllService(deps).logoutAll({
        userId: 7,
        currentSessionId: 3,
      }),
    ).resolves.toEqual({ revokedCount: 2 });
  });
});
