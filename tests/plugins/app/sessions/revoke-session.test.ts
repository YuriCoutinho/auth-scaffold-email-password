import { describe, expect, it, vi } from "vitest";
import { createRevokeSessionService } from "../../../../src/plugins/app/sessions/revoke-session.js";
import { createInMemoryStore } from "../../../helpers/in-memory-store.js";

const USER = "11111111-1111-4111-8111-111111111111";
const SESSION = "33333333-3333-4333-8333-333333333333";

function makeDeps(deleted: boolean) {
  return {
    repo: { deleteUserSession: vi.fn().mockResolvedValue({ deleted }) },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("revokeSession", () => {
  it("asks the repository to delete that session for that user", async () => {
    const deps = makeDeps(true);

    await createRevokeSessionService(deps).revokeSession({
      userId: USER,
      sessionId: SESSION,
    });

    expect(deps.repo.deleteUserSession).toHaveBeenCalledWith({
      id: SESSION,
      userId: USER,
    });
  });

  it("logs the revocation with the user and the session, and never a token", async () => {
    const deps = makeDeps(true);

    await createRevokeSessionService(deps).revokeSession({
      userId: USER,
      sessionId: SESSION,
    });

    expect(deps.log.info).toHaveBeenCalledWith(
      { userId: USER, sessionId: SESSION },
      "session revoked",
    );
  });

  it("stays silent and resolves the same way when nothing was deleted", async () => {
    const deps = makeDeps(false);

    await expect(
      createRevokeSessionService(deps).revokeSession({
        userId: USER,
        sessionId: SESSION,
      }),
    ).resolves.toBeUndefined();

    expect(deps.log.info).not.toHaveBeenCalled();
  });

  it("revokes an expired session the sweep has not removed yet, harmlessly", async () => {
    const store = createInMemoryStore({
      sessions: [
        {
          id: SESSION,
          userId: USER,
          tokenHash: "expired",
          createdAt: new Date(0),
        },
      ],
    });

    await expect(
      createRevokeSessionService({ repo: store.legacy }).revokeSession({
        userId: USER,
        sessionId: SESSION,
      }),
    ).resolves.toBeUndefined();

    expect(store.sessions.size).toBe(0);
  });

  it("works without a logger", async () => {
    const { log: _log, ...deps } = makeDeps(true);

    await expect(
      createRevokeSessionService(deps).revokeSession({
        userId: USER,
        sessionId: SESSION,
      }),
    ).resolves.toBeUndefined();
  });
});
