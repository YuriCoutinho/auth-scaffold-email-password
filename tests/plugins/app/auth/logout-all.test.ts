import { describe, expect, it, vi } from "vitest";
import { createLogoutAllService } from "../../../../src/plugins/app/auth/logout-all.js";

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
  it("excludes the current session by default", async () => {
    const deps = makeDeps();

    await createLogoutAllService(deps).logoutAll({
      userId: 7,
      currentSessionId: 3,
      includeCurrentSession: false,
    });

    expect(deps.repo.revokeAllUserSessions).toHaveBeenCalledWith({
      userId: 7,
      revokedAt: NOW,
      revokedReason: "logout_all",
      exceptSessionId: 3,
    });
  });

  it("omits the exclusion entirely when the current session is included", async () => {
    const deps = makeDeps();

    await createLogoutAllService(deps).logoutAll({
      userId: 7,
      currentSessionId: 3,
      includeCurrentSession: true,
    });

    expect(deps.repo.revokeAllUserSessions).toHaveBeenCalledWith({
      userId: 7,
      revokedAt: NOW,
      revokedReason: "logout_all",
    });
  });

  it("reports the current session as surviving when it was excluded", async () => {
    const result = await createLogoutAllService(makeDeps()).logoutAll({
      userId: 7,
      currentSessionId: 3,
      includeCurrentSession: false,
    });

    expect(result).toEqual({ revokedCount: 2, currentSessionRevoked: false });
  });

  it("reports the current session as revoked when it was included", async () => {
    const result = await createLogoutAllService(makeDeps(3)).logoutAll({
      userId: 7,
      currentSessionId: 3,
      includeCurrentSession: true,
    });

    expect(result).toEqual({ revokedCount: 3, currentSessionRevoked: true });
  });

  it("succeeds when the user has no other session to revoke", async () => {
    const result = await createLogoutAllService(makeDeps(0)).logoutAll({
      userId: 7,
      currentSessionId: 3,
      includeCurrentSession: false,
    });

    expect(result).toEqual({ revokedCount: 0, currentSessionRevoked: false });
  });

  it("logs the event with the count and the scope, and never a token", async () => {
    const deps = makeDeps(5);

    await createLogoutAllService(deps).logoutAll({
      userId: 7,
      currentSessionId: 3,
      includeCurrentSession: true,
    });

    expect(deps.log.info).toHaveBeenCalledWith(
      { userId: 7, revokedCount: 5, includeCurrentSession: true },
      "all sessions revoked",
    );
  });

  it("works without a logger", async () => {
    const { log: _log, ...deps } = makeDeps();

    await expect(
      createLogoutAllService(deps).logoutAll({
        userId: 7,
        currentSessionId: 3,
        includeCurrentSession: false,
      }),
    ).resolves.toEqual({ revokedCount: 2, currentSessionRevoked: false });
  });
});
