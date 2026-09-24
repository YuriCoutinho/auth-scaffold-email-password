import { describe, expect, it, vi } from "vitest";
import { retentionCutoffs } from "../../../../src/lib/retention.js";
import type { TtlPolicy } from "../../../../src/lib/ttl.js";
import { createRetention } from "../../../../src/plugins/app/retention/create-retention.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const TTL: TtlPolicy = {
  sessionSeconds: 1000,
  signupCodeSeconds: 100,
  passwordResetCodeSeconds: 200,
};
const COUNTS = {
  sessions: 2,
  verificationCodes: 3,
  unverifiedUsers: 1,
  throttleTrails: 4,
};

function makeDeps(purge = vi.fn().mockResolvedValue(COUNTS)) {
  return {
    repository: { purge },
    ttl: TTL,
    log: { info: vi.fn(), error: vi.fn() },
    now: () => NOW,
  };
}

describe("sweep", () => {
  it("purges with the cutoffs of the configured ttl at the current time", async () => {
    const deps = makeDeps();

    await createRetention(deps).sweep();

    expect(deps.repository.purge).toHaveBeenCalledExactlyOnceWith(
      retentionCutoffs(TTL, NOW),
    );
    expect(deps.repository.purge).toHaveBeenCalledWith(
      expect.objectContaining({
        signupCodesIssuedBefore: new Date(NOW.getTime() - 300_000),
      }),
    );
  });

  it("returns and logs what was deleted", async () => {
    const deps = makeDeps();

    await expect(createRetention(deps).sweep()).resolves.toEqual(COUNTS);

    expect(deps.log.info).toHaveBeenCalledWith(
      COUNTS,
      "retention sweep finished",
    );
  });

  it("never rejects, and logs the failure", async () => {
    const error = new Error("connection lost");
    const deps = makeDeps(vi.fn().mockRejectedValue(error));

    await expect(createRetention(deps).sweep()).resolves.toBeNull();

    expect(deps.log.error).toHaveBeenCalledWith(
      { err: error },
      "retention sweep failed",
    );
    expect(deps.log.info).not.toHaveBeenCalled();
  });

  it("works without a logger", async () => {
    const { log: _log, ...deps } = makeDeps(
      vi.fn().mockRejectedValue(new Error("boom")),
    );

    await expect(createRetention(deps).sweep()).resolves.toBeNull();
  });
});
