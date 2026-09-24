import { beforeEach, describe, expect, it } from "vitest";
import { THROTTLE_MAX_BLOCK_SECONDS } from "../../../../src/lib/throttle.js";
import { hashThrottleKey } from "../../../../src/lib/token-hash.js";
import { createCredentialThrottle } from "../../../../src/plugins/app/credential-throttle/create-credential-throttle.js";
import { createInMemoryCredentialThrottleRepository } from "../../../helpers/credential-throttle/in-memory-repository.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const KEY = "foo@gmail.com";
const KEY_HASH = hashThrottleKey(KEY);

let repo: ReturnType<typeof createInMemoryCredentialThrottleRepository>;

function makeThrottle(now: Date = NOW) {
  return createCredentialThrottle({ repository: repo, now: () => now });
}

beforeEach(() => {
  repo = createInMemoryCredentialThrottleRepository();
});

describe("check", () => {
  it("allows a key with no row", async () => {
    await expect(makeThrottle().check(KEY)).resolves.toEqual({
      outcome: "allowed",
    });
  });

  it("allows a key whose block has already elapsed", async () => {
    repo.rows.set(KEY_HASH, {
      failedCount: 4,
      lastFailedAt: new Date(NOW.getTime() - 120_000),
      blockedUntil: new Date(NOW.getTime() - 1_000),
    });
    await expect(makeThrottle().check(KEY)).resolves.toEqual({
      outcome: "allowed",
    });
  });

  it("blocks and reports the whole remaining seconds", async () => {
    repo.rows.set(KEY_HASH, {
      failedCount: 5,
      lastFailedAt: NOW,
      blockedUntil: new Date(NOW.getTime() + 90_000),
    });
    await expect(makeThrottle().check(KEY)).resolves.toEqual({
      outcome: "blocked",
      retryAfterSeconds: 90,
    });
  });

  it("never reports a Retry-After below one second", async () => {
    repo.rows.set(KEY_HASH, {
      failedCount: 5,
      lastFailedAt: NOW,
      blockedUntil: new Date(NOW.getTime() + 400),
    });
    await expect(makeThrottle().check(KEY)).resolves.toEqual({
      outcome: "blocked",
      retryAfterSeconds: 1,
    });
  });

  it("hashes the key instead of storing the address", async () => {
    await makeThrottle().registerFailure(KEY);
    expect([...repo.rows.keys()]).toEqual([KEY_HASH]);
    expect([...repo.rows.keys()][0]).not.toContain("@");
  });
});

describe("registerFailure", () => {
  it("counts the first failure without opening a block", async () => {
    await makeThrottle().registerFailure(KEY);
    expect(repo.rows.get(KEY_HASH)).toEqual({
      failedCount: 1,
      lastFailedAt: NOW,
      blockedUntil: null,
    });
  });

  it("opens a one-minute block on the fourth consecutive failure", async () => {
    repo.rows.set(KEY_HASH, {
      failedCount: 3,
      lastFailedAt: NOW,
      blockedUntil: null,
    });
    await makeThrottle().registerFailure(KEY);
    expect(repo.rows.get(KEY_HASH)).toEqual({
      failedCount: 4,
      lastFailedAt: NOW,
      blockedUntil: new Date(NOW.getTime() + 60_000),
    });
  });

  it("starts over when the last failure is older than the cap", async () => {
    repo.rows.set(KEY_HASH, {
      failedCount: 7,
      lastFailedAt: new Date(
        NOW.getTime() - (THROTTLE_MAX_BLOCK_SECONDS + 1) * 1000,
      ),
      blockedUntil: null,
    });
    await makeThrottle().registerFailure(KEY);
    expect(repo.rows.get(KEY_HASH)).toEqual({
      failedCount: 1,
      lastFailedAt: NOW,
      blockedUntil: null,
    });
  });

  it("counts a key that belongs to no account, so the block is blind to existence", async () => {
    await makeThrottle().registerFailure("nobody@gmail.com");
    expect(repo.rows.get(hashThrottleKey("nobody@gmail.com"))).toMatchObject({
      failedCount: 1,
    });
  });
});

describe("reset", () => {
  it("drops the row so a success starts the count over", async () => {
    repo.rows.set(KEY_HASH, {
      failedCount: 4,
      lastFailedAt: NOW,
      blockedUntil: new Date(NOW.getTime() + 60_000),
    });
    await makeThrottle().reset(KEY);
    expect(repo.rows.has(KEY_HASH)).toBe(false);
  });
});
