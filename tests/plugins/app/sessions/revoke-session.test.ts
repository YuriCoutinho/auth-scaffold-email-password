import { describe, expect, it, vi } from "vitest";
import { createRevokeSessionService } from "../../../../src/plugins/app/sessions/revoke-session.js";

const NOW = new Date("2026-02-01T00:00:00.000Z");
const PUBLIC_ID = "33333333-3333-4333-8333-333333333333";

describe("revokeSession", () => {
  it("asks the repository to revoke that session for that user", async () => {
    const repo = {
      revokeUserSessionByPublicId: vi.fn().mockResolvedValue({ revoked: true }),
    };
    const { revokeSession } = createRevokeSessionService({
      repo,
      now: () => NOW,
    });

    await revokeSession({ userId: 7, publicId: PUBLIC_ID });

    expect(repo.revokeUserSessionByPublicId).toHaveBeenCalledWith({
      publicId: PUBLIC_ID,
      userId: 7,
      revokedAt: NOW,
      revokedReason: "session_revoked",
      now: NOW,
    });
  });

  it("logs the revocation with the user and the session, and never a token", async () => {
    const repo = {
      revokeUserSessionByPublicId: vi.fn().mockResolvedValue({ revoked: true }),
    };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { revokeSession } = createRevokeSessionService({
      repo,
      log,
      now: () => NOW,
    });

    await revokeSession({ userId: 7, publicId: PUBLIC_ID });

    expect(log.info).toHaveBeenCalledWith(
      { userId: 7, sessionPublicId: PUBLIC_ID },
      "session revoked",
    );
  });

  it("stays silent when nothing was revoked", async () => {
    const repo = {
      revokeUserSessionByPublicId: vi
        .fn()
        .mockResolvedValue({ revoked: false }),
    };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { revokeSession } = createRevokeSessionService({
      repo,
      log,
      now: () => NOW,
    });

    await revokeSession({ userId: 7, publicId: PUBLIC_ID });

    expect(log.info).not.toHaveBeenCalled();
  });

  it("resolves the same way whether it revoked or not", async () => {
    const repo = {
      revokeUserSessionByPublicId: vi
        .fn()
        .mockResolvedValue({ revoked: false }),
    };
    const { revokeSession } = createRevokeSessionService({
      repo,
      now: () => NOW,
    });

    await expect(
      revokeSession({ userId: 7, publicId: PUBLIC_ID }),
    ).resolves.toBeUndefined();
  });

  it("works without a logger", async () => {
    const repo = {
      revokeUserSessionByPublicId: vi.fn().mockResolvedValue({ revoked: true }),
    };
    const { revokeSession } = createRevokeSessionService({
      repo,
      now: () => NOW,
    });

    await expect(
      revokeSession({ userId: 7, publicId: PUBLIC_ID }),
    ).resolves.toBeUndefined();
  });
});
