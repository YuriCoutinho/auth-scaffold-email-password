import { describe, expect, it, vi } from "vitest";
import { createLogoutAllService } from "../../../../src/plugins/app/sessions/logout-all.js";

const USER = "11111111-1111-4111-8111-111111111111";
const CURRENT = "22222222-2222-4222-8222-222222222222";

function makeDeps(deletedCount = 2) {
  return {
    repo: {
      deleteUserSessions: vi.fn().mockResolvedValue({ deletedCount }),
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("logoutAll", () => {
  it("always keeps the current session out of the deletion", async () => {
    const deps = makeDeps();

    await createLogoutAllService(deps).logoutAll({
      userId: USER,
      currentSessionId: CURRENT,
    });

    expect(deps.repo.deleteUserSessions).toHaveBeenCalledWith({
      userId: USER,
      exceptSessionId: CURRENT,
    });
  });

  it("reports how many sessions were revoked", async () => {
    const result = await createLogoutAllService(makeDeps(3)).logoutAll({
      userId: USER,
      currentSessionId: CURRENT,
    });

    expect(result).toEqual({ revokedCount: 3 });
  });

  it("succeeds when the user has no other session to revoke", async () => {
    const result = await createLogoutAllService(makeDeps(0)).logoutAll({
      userId: USER,
      currentSessionId: CURRENT,
    });

    expect(result).toEqual({ revokedCount: 0 });
  });

  it("logs the event with the count, and never a token", async () => {
    const deps = makeDeps(5);

    await createLogoutAllService(deps).logoutAll({
      userId: USER,
      currentSessionId: CURRENT,
    });

    expect(deps.log.info).toHaveBeenCalledWith(
      { userId: USER, revokedCount: 5 },
      "all sessions revoked",
    );
  });

  it("works without a logger", async () => {
    const { log: _log, ...deps } = makeDeps();

    await expect(
      createLogoutAllService(deps).logoutAll({
        userId: USER,
        currentSessionId: CURRENT,
      }),
    ).resolves.toEqual({ revokedCount: 2 });
  });
});
