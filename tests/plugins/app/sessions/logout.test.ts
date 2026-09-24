import { describe, expect, it, vi } from "vitest";
import { hashSessionToken } from "../../../../src/lib/token-hash.js";
import { createLogoutService } from "../../../../src/plugins/app/sessions/logout.js";

const TOKEN = "a-session-token";

function makeDeps() {
  return {
    repo: { deleteSessionByTokenHash: vi.fn().mockResolvedValue(undefined) },
  };
}

describe("logout", () => {
  it("deletes the session behind the hash of the token, never the token", async () => {
    const deps = makeDeps();

    await createLogoutService(deps).logout(TOKEN);

    expect(deps.repo.deleteSessionByTokenHash).toHaveBeenCalledExactlyOnceWith(
      hashSessionToken(TOKEN),
    );
  });

  it("does nothing without a cookie", async () => {
    const deps = makeDeps();

    await createLogoutService(deps).logout(undefined);

    expect(deps.repo.deleteSessionByTokenHash).not.toHaveBeenCalled();
  });

  it("does nothing for an empty cookie", async () => {
    const deps = makeDeps();

    await createLogoutService(deps).logout("");

    expect(deps.repo.deleteSessionByTokenHash).not.toHaveBeenCalled();
  });

  it("resolves for a token with no matching session", async () => {
    await expect(
      createLogoutService(makeDeps()).logout("unknown-token"),
    ).resolves.toBeUndefined();
  });
});
