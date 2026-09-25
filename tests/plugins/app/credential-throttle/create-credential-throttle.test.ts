import { beforeEach, describe, expect, it, vi } from "vitest";
import { THROTTLE_MAX_BLOCK_SECONDS } from "../../../../src/lib/throttle.js";
import { hashThrottleKey } from "../../../../src/lib/token-hash.js";
import { createCredentialThrottle } from "../../../../src/plugins/app/credential-throttle/create-credential-throttle.js";
import { TEST_HMAC_SECRET } from "../../../helpers/app-options.js";
import { createInMemoryStore } from "../../../helpers/in-memory-store.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const KEY = "foo@gmail.com";
const KEY_HASH = hashThrottleKey(TEST_HMAC_SECRET, KEY);

let store: ReturnType<typeof createInMemoryStore>;

function makeThrottle(now: Date = NOW) {
  return createCredentialThrottle({
    hmacSecret: TEST_HMAC_SECRET,
    repository: store.legacy,
    now: () => now,
  });
}

beforeEach(() => {
  store = createInMemoryStore();
});

describe("check", () => {
  it("allows a key with no row", async () => {
    await expect(makeThrottle().check(KEY)).resolves.toEqual({
      outcome: "allowed",
    });
  });

  it("allows a key whose block has already elapsed", async () => {
    store.throttle.set(KEY_HASH, {
      failedCount: 4,
      lastFailedAt: new Date(NOW.getTime() - 120_000),
    });
    await expect(makeThrottle().check(KEY)).resolves.toEqual({
      outcome: "allowed",
    });
  });

  it("allows a key whose failures are still free", async () => {
    store.throttle.set(KEY_HASH, { failedCount: 3, lastFailedAt: NOW });
    await expect(makeThrottle().check(KEY)).resolves.toEqual({
      outcome: "allowed",
    });
  });

  it("derives the block from the count and the last failure", async () => {
    // Five failures block for 300 seconds, 210 of which already elapsed.
    store.throttle.set(KEY_HASH, {
      failedCount: 5,
      lastFailedAt: new Date(NOW.getTime() - 210_000),
    });
    await expect(makeThrottle().check(KEY)).resolves.toEqual({
      outcome: "blocked",
      retryAfterSeconds: 90,
    });
  });

  it("never reports a Retry-After below one second", async () => {
    store.throttle.set(KEY_HASH, {
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
    expect([...store.throttle.keys()]).toEqual([KEY_HASH]);
    expect([...store.throttle.keys()][0]).not.toContain("@");
  });
});

describe("registerFailure", () => {
  it("counts the first failure without opening a block", async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const throttle = createCredentialThrottle({
      hmacSecret: TEST_HMAC_SECRET,
      repository: store.legacy,
      log,
      now: () => NOW,
    });
    await throttle.registerFailure(KEY);
    expect(store.throttle.get(KEY_HASH)).toEqual({
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
      repository: store.legacy,
      log,
      now: () => NOW,
    });
    store.throttle.set(KEY_HASH, {
      failedCount: 3,
      lastFailedAt: new Date(NOW.getTime() - 5_000),
    });
    await throttle.registerFailure(KEY);
    expect(store.throttle.get(KEY_HASH)).toEqual({
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
    store.throttle.set(KEY_HASH, {
      failedCount: 7,
      lastFailedAt: new Date(
        NOW.getTime() - (THROTTLE_MAX_BLOCK_SECONDS + 1) * 1000,
      ),
    });
    await makeThrottle().registerFailure(KEY);
    expect(store.throttle.get(KEY_HASH)).toEqual({
      failedCount: 1,
      lastFailedAt: NOW,
    });
  });

  it("counts a key that belongs to no account, so the block is blind to existence", async () => {
    await makeThrottle().registerFailure("nobody@gmail.com");
    expect(
      store.throttle.get(hashThrottleKey(TEST_HMAC_SECRET, "nobody@gmail.com")),
    ).toMatchObject({
      failedCount: 1,
    });
  });
});

describe("reset", () => {
  it("drops the row so a success starts the count over", async () => {
    store.throttle.set(KEY_HASH, {
      failedCount: 4,
      lastFailedAt: NOW,
    });
    await makeThrottle().reset(KEY);
    expect(store.throttle.has(KEY_HASH)).toBe(false);
  });
});
