import { describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../src/db/client.js";
import { createRetentionSweep } from "../../../src/features/retention-sweep/use-case.js";
import { DEFAULT_TTL } from "../../../src/lib/ttl.js";
import { THROTTLE_MAX_BLOCK_SECONDS } from "../../../src/modules/credential-throttle/policy.js";
import { createCredentialThrottleService } from "../../../src/modules/credential-throttle/service.js";
import { createOtpService } from "../../../src/modules/otp/service.js";
import { createSessionsService } from "../../../src/modules/sessions/service.js";
import { createUsersService } from "../../../src/modules/users/service.js";
import { FakeEmailSender } from "../../../src/plugins/email/drivers/fake.js";
import { TEST_HMAC_SECRET } from "../../helpers/app-options.js";
import {
  createInMemoryStore,
  type InMemorySeed,
  type InMemoryStore,
} from "../../helpers/in-memory-store.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const USER = "11111111-1111-4111-8111-111111111111";

// The store's repository factories ignore the executor they are handed, so
// any value satisfying the type stands in for a real connection.
const db = {} as Executor;

function makeServices(store: InMemoryStore) {
  const emailSender = new FakeEmailSender();
  return {
    sessions: createSessionsService({
      repo: store.repositories.sessions(db),
      ttl: DEFAULT_TTL,
    }),
    otp: createOtpService({
      repo: store.repositories.otp(db),
      emailSender,
      ttl: DEFAULT_TTL,
      hmacSecret: TEST_HMAC_SECRET,
    }),
    users: createUsersService({
      repo: store.repositories.users(db),
      emailSender,
    }),
    credentialThrottle: createCredentialThrottleService({
      repo: store.repositories.credentialThrottle(db),
      hmacSecret: TEST_HMAC_SECRET,
    }),
  };
}

function makeSweep(seed: InMemorySeed = {}, now: () => Date = () => NOW) {
  const store = createInMemoryStore(seed);
  const services = makeServices(store);
  const log = { info: vi.fn(), error: vi.fn() };
  return {
    store,
    log,
    sweep: createRetentionSweep({ ...services, log, now }),
  };
}

describe("retention sweep", () => {
  it("purges expired sessions and codes, abandoned users and stale throttle trails", async () => {
    const expiredAt = new Date(NOW.getTime() - 1000);
    const { store, sweep } = makeSweep({
      sessions: [
        {
          id: "expired",
          userId: USER,
          tokenHash: "expired",
          expiresAt: expiredAt,
        },
      ],
      verificationCodes: [
        {
          userId: USER,
          purpose: "signup",
          issuedAt: expiredAt,
          expiresAt: expiredAt,
        },
      ],
      users: [{ id: USER, email: "user@example.com", emailVerifiedAt: null }],
    });
    store.throttle.set("stale-key", {
      failedCount: 1,
      lastFailedAt: new Date(
        NOW.getTime() - (THROTTLE_MAX_BLOCK_SECONDS + 1) * 1000,
      ),
    });

    const counts = await sweep();

    expect(counts).toEqual({
      sessions: 1,
      verificationCodes: 1,
      unverifiedUsers: 1,
      throttleTrails: 1,
    });
    expect(store.sessions.size).toBe(0);
    expect(store.verificationCodes.size).toBe(0);
    expect(store.users.size).toBe(0);
    expect(store.throttle.size).toBe(0);
  });

  it("deletes a pending signup whose only code has expired in the same sweep", async () => {
    const expiredAt = new Date(NOW.getTime() - 1000);
    const { store, sweep } = makeSweep({
      users: [{ id: USER, email: "user@example.com", emailVerifiedAt: null }],
      verificationCodes: [
        {
          userId: USER,
          purpose: "signup",
          issuedAt: expiredAt,
          expiresAt: expiredAt,
        },
      ],
    });

    const counts = await sweep();

    expect(counts).toEqual({
      sessions: 0,
      verificationCodes: 1,
      unverifiedUsers: 1,
      throttleTrails: 0,
    });
    expect(store.users.has(USER)).toBe(false);
  });

  it("logs what was deleted", async () => {
    const { log, sweep } = makeSweep();

    const counts = await sweep();

    expect(log.info).toHaveBeenCalledWith(counts, "retention sweep finished");
  });

  it("never rejects, and logs the failure", async () => {
    const store = createInMemoryStore();
    const services = makeServices(store);
    const error = new Error("connection lost");
    const log = { info: vi.fn(), error: vi.fn() };
    const sweep = createRetentionSweep({
      ...services,
      sessions: { purgeExpired: vi.fn().mockRejectedValue(error) },
      log,
      now: () => NOW,
    });

    await expect(sweep()).resolves.toBeNull();

    expect(log.error).toHaveBeenCalledWith(
      { err: error },
      "retention sweep failed",
    );
    expect(log.info).not.toHaveBeenCalled();
  });

  it("works without a logger", async () => {
    const store = createInMemoryStore();
    const services = makeServices(store);
    const sweep = createRetentionSweep({
      ...services,
      sessions: {
        purgeExpired: vi.fn().mockRejectedValue(new Error("boom")),
      },
      now: () => NOW,
    });

    await expect(sweep()).resolves.toBeNull();
  });
});
