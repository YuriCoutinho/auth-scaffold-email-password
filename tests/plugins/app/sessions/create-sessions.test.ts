import { describe, expect, it } from "vitest";
import { createSessions } from "../../../../src/plugins/app/sessions/create-sessions.js";
import { createInMemoryAuthRepository } from "../../../helpers/auth/in-memory-repository.js";

describe("createSessions", () => {
  it("exposes every session flow over one repository", async () => {
    const sessions = createSessions({
      repository: createInMemoryAuthRepository(),
    });

    await expect(sessions.logout("unknown-token")).resolves.toBeUndefined();
    expect(
      await sessions.logoutAll({ userId: 999, currentSessionId: 1 }),
    ).toEqual({ revokedCount: 0 });
    expect(
      await sessions.listSessions({ userId: 999, currentSessionId: 1 }),
    ).toEqual([]);
  });
});
