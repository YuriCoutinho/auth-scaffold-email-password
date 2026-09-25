import { beforeEach, describe, expect, it, vi } from "vitest";
import { THROTTLE_MAX_BLOCK_SECONDS } from "../../../../src/lib/throttle.js";
import { hashThrottleKey } from "../../../../src/lib/token-hash.js";
import { createCredentialThrottle } from "../../../../src/plugins/app/credential-throttle/create-credential-throttle.js";
import { TEST_HMAC_SECRET } from "../../../helpers/app-options.js";
import { createInMemoryCredentialThrottleRepository } from "../../../helpers/credential-throttle/in-memory-repository.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const KEY = "foo@gmail.com";
const KEY_HASH = hashThrottleKey(TEST_HMAC_SECRET, KEY);

let repo: ReturnType<typeof createInMemoryCredentialThrottleRepository>;

function makeThrottle(now: Date = NOW) {
  return createCredentialThrottle({
    hmacSecret: TEST_HMAC_SECRET,
    repository: repo,
    now: () => now,
  });
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
    });
    await expect(makeThrottle().check(KEY)).resolves.toEqual({
      outcome: "allowed",
    });
  });

  it("allows a key whose failures are still free", async () => {
    repo.rows.set(KEY_HASH, { failedCount: 3, lastFailedAt: NOW });
    await expect(makeThrottle().check(KEY)).resolves.toEqual({
      outcome: "allowed",
    });
  });

  it("derives the block from the count and the last failure", async () => {
    // Five failures block for 300 seconds, 210 of which already elapsed.
    repo.rows.set(KEY_HASH, {
      failedCount: 5,
      lastFailedAt: new Date(NOW.getTime() - 210_000),
    });
    await expect(makeThrottle().check(KEY)).resolves.toEqual({
      outcome: "blocked",
      retryAfterSeconds: 90,
    });
  });

  it("never reports a Retry-After below one second", async () => {
    repo.rows.set(KEY_HASH, {
      failedCount: 4,
      lastFailedAt: new Date(NOW.getTime() - 59_600),
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
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const throttle = createCredentialThrottle({
      hmacSecret: TEST_HMAC_SECRET,
      repository: repo,
      log,
      now: () => NOW,
    });
    await throttle.registerFailure(KEY);
    expect(repo.rows.get(KEY_HASH)).toEqual({
      failedCount: 1,
      lastFailedAt: NOW,
    });
    await expect(throttle.check(KEY)).resolves.toEqual({ outcome: "allowed" });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("opens a one-minute block on the fourth consecutive failure", async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const throttle = createCredentialThrottle({
      hmacSecret: TEST_HMAC_SECRET,
      repository: repo,
      log,
      now: () => NOW,
    });
    repo.rows.set(KEY_HASH, {
      failedCount: 3,
      lastFailedAt: new Date(NOW.getTime() - 5_000),
    });
    await throttle.registerFailure(KEY);
    expect(repo.rows.get(KEY_HASH)).toEqual({
      failedCount: 4,
      lastFailedAt: NOW,
    });
    await expect(throttle.check(KEY)).resolves.toEqual({
      outcome: "blocked",
      retryAfterSeconds: 60,
    });
    expect(log.warn).toHaveBeenCalledWith(
      { failedCount: 4, blockedUntil: new Date(NOW.getTime() + 60_000) },
      "credential attempts throttled",
    );
  });

  it("starts over when the last failure is older than the cap", async () => {
    repo.rows.set(KEY_HASH, {
      failedCount: 7,
      lastFailedAt: new Date(
        NOW.getTime() - (THROTTLE_MAX_BLOCK_SECONDS + 1) * 1000,
      ),
    });
    await makeThrottle().registerFailure(KEY);
    expect(repo.rows.get(KEY_HASH)).toEqual({
      failedCount: 1,
      lastFailedAt: NOW,
    });
  });

  it("counts a key that belongs to no account, so the block is blind to existence", async () => {
    await makeThrottle().registerFailure("nobody@gmail.com");
    expect(
      repo.rows.get(hashThrottleKey(TEST_HMAC_SECRET, "nobody@gmail.com")),
    ).toMatchObject({
      failedCount: 1,
    });
  });
});

describe("reset", () => {
  it("drops the row so a success starts the count over", async () => {
    repo.rows.set(KEY_HASH, {
      failedCount: 4,
      lastFailedAt: NOW,
    });
    await makeThrottle().reset(KEY);
    expect(repo.rows.has(KEY_HASH)).toBe(false);
  });
});
