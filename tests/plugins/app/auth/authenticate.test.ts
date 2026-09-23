import { describe, expect, it, vi } from "vitest";
import { hashSessionToken } from "../../../../src/lib/token-hash.js";
import { createAuthenticateService } from "../../../../src/plugins/app/auth/authenticate.js";
import type { SessionRecord } from "../../../../src/plugins/app/auth/repository.js";

const NOW = new Date("2026-09-23T12:00:00Z");
const TOKEN = "a-session-token";

function makeDeps(session: SessionRecord | undefined) {
  return {
    repo: { findSessionByTokenHash: vi.fn().mockResolvedValue(session) },
    now: () => NOW,
  };
}

function validSession(): SessionRecord {
  return {
    id: 1,
    userId: 7,
    expiresAt: new Date(NOW.getTime() + 1000),
    revokedAt: null,
  };
}

describe("authenticate", () => {
  it("returns the user id and the session id for an active session", async () => {
    const deps = makeDeps(validSession());
    const result = await createAuthenticateService(deps).authenticate(TOKEN);
    expect(result).toEqual({
      outcome: "authenticated",
      user: { id: 7 },
      session: { id: 1 },
    });
  });

  it("reports the session that the token resolved to, not the first one", async () => {
    const deps = makeDeps({ ...validSession(), id: 42 });
    const result = await createAuthenticateService(deps).authenticate(TOKEN);
    expect(result).toMatchObject({ session: { id: 42 } });
  });

  it("looks the session up by the hash of the token, never by the token", async () => {
    const deps = makeDeps(validSession());
    await createAuthenticateService(deps).authenticate(TOKEN);
    expect(deps.repo.findSessionByTokenHash).toHaveBeenCalledWith(
      hashSessionToken(TOKEN),
    );
    expect(deps.repo.findSessionByTokenHash).not.toHaveBeenCalledWith(TOKEN);
  });

  it("rejects a missing cookie without touching the repository", async () => {
    const deps = makeDeps(validSession());
    const result =
      await createAuthenticateService(deps).authenticate(undefined);
    expect(result).toEqual({ outcome: "invalid" });
    expect(deps.repo.findSessionByTokenHash).not.toHaveBeenCalled();
  });

  it("rejects an empty cookie without touching the repository", async () => {
    const deps = makeDeps(validSession());
    const result = await createAuthenticateService(deps).authenticate("");
    expect(result).toEqual({ outcome: "invalid" });
    expect(deps.repo.findSessionByTokenHash).not.toHaveBeenCalled();
  });

  it("rejects a token with no matching session", async () => {
    const deps = makeDeps(undefined);
    expect(await createAuthenticateService(deps).authenticate(TOKEN)).toEqual({
      outcome: "invalid",
    });
  });

  it("rejects a revoked session even when it has not expired", async () => {
    const deps = makeDeps({
      ...validSession(),
      revokedAt: new Date(NOW.getTime() - 1000),
    });
    expect(await createAuthenticateService(deps).authenticate(TOKEN)).toEqual({
      outcome: "invalid",
    });
  });

  it("rejects an expired session", async () => {
    const deps = makeDeps({
      ...validSession(),
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    expect(await createAuthenticateService(deps).authenticate(TOKEN)).toEqual({
      outcome: "invalid",
    });
  });

  it("rejects a session that expires exactly now", async () => {
    const deps = makeDeps({ ...validSession(), expiresAt: NOW });
    expect(await createAuthenticateService(deps).authenticate(TOKEN)).toEqual({
      outcome: "invalid",
    });
  });
});
