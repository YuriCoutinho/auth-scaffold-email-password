import { describe, expect, it, vi } from "vitest";
import { hashSessionToken } from "../../../../src/lib/token-hash.js";
import { createLogoutService } from "../../../../src/plugins/app/auth/logout.js";

const NOW = new Date("2026-09-23T12:00:00Z");
const TOKEN = "a-session-token";

function makeDeps() {
  return {
    repo: { revokeSessionByTokenHash: vi.fn().mockResolvedValue(undefined) },
    now: () => NOW,
  };
}

describe("logout", () => {
  it("revokes the session behind the token, stamped with the current time", async () => {
    const deps = makeDeps();

    await createLogoutService(deps).logout(TOKEN);

    expect(deps.repo.revokeSessionByTokenHash).toHaveBeenCalledWith(
      hashSessionToken(TOKEN),
      NOW,
      "user_logout",
    );
  });

  it("sends the hash of the token, never the token", async () => {
    const deps = makeDeps();

    await createLogoutService(deps).logout(TOKEN);

    expect(deps.repo.revokeSessionByTokenHash).not.toHaveBeenCalledWith(
      TOKEN,
      expect.anything(),
      expect.anything(),
    );
  });

  it("does nothing without a cookie", async () => {
    const deps = makeDeps();

    await createLogoutService(deps).logout(undefined);

    expect(deps.repo.revokeSessionByTokenHash).not.toHaveBeenCalled();
  });

  it("does nothing for an empty cookie", async () => {
    const deps = makeDeps();

    await createLogoutService(deps).logout("");

    expect(deps.repo.revokeSessionByTokenHash).not.toHaveBeenCalled();
  });

  it("resolves for a token with no matching session", async () => {
    const deps = makeDeps();

    await expect(
      createLogoutService(deps).logout("unknown-token"),
    ).resolves.toBeUndefined();
  });
});
