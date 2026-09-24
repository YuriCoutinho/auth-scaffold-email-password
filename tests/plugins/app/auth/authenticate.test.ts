import { describe, expect, it, vi } from "vitest";
import { hashSessionToken } from "../../../../src/lib/token-hash.js";
import { createAuthenticateService } from "../../../../src/plugins/app/auth/authenticate.js";
import type { SessionRecord } from "../../../../src/plugins/app/sessions/repository.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const TOKEN = "a-session-token";
const TTL_SECONDS = 60 * 60;
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function makeDeps(session: SessionRecord | undefined) {
  return {
    repo: { findSessionByTokenHash: vi.fn().mockResolvedValue(session) },
    sessionTtlSeconds: TTL_SECONDS,
    now: () => NOW,
  };
}

function createdSecondsAgo(seconds: number): SessionRecord {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    createdAt: new Date(NOW.getTime() - seconds * 1000),
  };
}

describe("authenticate", () => {
  it("returns the user id and the session id for a live session", async () => {
    const deps = makeDeps(createdSecondsAgo(60));
    expect(await createAuthenticateService(deps).authenticate(TOKEN)).toEqual({
      outcome: "authenticated",
      user: { id: USER_ID },
      session: { id: SESSION_ID },
    });
  });

  it("looks the session up by the hash of the token, never by the token", async () => {
    const deps = makeDeps(createdSecondsAgo(60));
    await createAuthenticateService(deps).authenticate(TOKEN);
    expect(deps.repo.findSessionByTokenHash).toHaveBeenCalledWith(
      hashSessionToken(TOKEN),
    );
    expect(deps.repo.findSessionByTokenHash).not.toHaveBeenCalledWith(TOKEN);
  });

  it.each([undefined, ""])(
    "rejects a missing cookie (%j) without touching the repository",
    async (token) => {
      const deps = makeDeps(createdSecondsAgo(60));
      expect(await createAuthenticateService(deps).authenticate(token)).toEqual(
        { outcome: "invalid" },
      );
      expect(deps.repo.findSessionByTokenHash).not.toHaveBeenCalled();
    },
  );

  it("rejects a token with no matching session, which is what a deleted session gets", async () => {
    const deps = makeDeps(undefined);
    expect(await createAuthenticateService(deps).authenticate(TOKEN)).toEqual({
      outcome: "invalid",
    });
  });

  it("rejects a session older than the configured ttl", async () => {
    const deps = makeDeps(createdSecondsAgo(TTL_SECONDS + 1));
    expect(await createAuthenticateService(deps).authenticate(TOKEN)).toEqual({
      outcome: "invalid",
    });
  });

  it("rejects a session that expires exactly now", async () => {
    const deps = makeDeps(createdSecondsAgo(TTL_SECONDS));
    expect(await createAuthenticateService(deps).authenticate(TOKEN)).toEqual({
      outcome: "invalid",
    });
  });

  it("accepts a session one second before it expires", async () => {
    const deps = makeDeps(createdSecondsAgo(TTL_SECONDS - 1));
    expect(
      (await createAuthenticateService(deps).authenticate(TOKEN)).outcome,
    ).toBe("authenticated");
  });
});
