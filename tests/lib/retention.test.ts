import { describe, expect, it } from "vitest";
import {
  CODE_GRACE_SECONDS,
  RETENTION_MULTIPLIER,
  retentionCutoffs,
  SESSION_GRACE_SECONDS,
} from "../../src/lib/retention.js";
import { THROTTLE_MAX_BLOCK_SECONDS } from "../../src/lib/throttle.js";
import type { TtlPolicy } from "../../src/lib/ttl.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const TTL: TtlPolicy = {
  sessionSeconds: 1000,
  signupCodeSeconds: 100,
  passwordResetCodeSeconds: 200,
};

function secondsAgo(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

describe("retentionCutoffs", () => {
  it("keeps sessions one day past their expiry", () => {
    expect(SESSION_GRACE_SECONDS).toBe(24 * 60 * 60);
    expect(retentionCutoffs(TTL, NOW).sessionsExpiredBefore).toEqual(
      secondsAgo(24 * 60 * 60),
    );
  });

  it("keeps codes thirty minutes past their expiry, whatever the purpose", () => {
    expect(CODE_GRACE_SECONDS).toBe(30 * 60);
    expect(retentionCutoffs(TTL, NOW).verificationCodesExpiredBefore).toEqual(
      secondsAgo(30 * 60),
    );
  });

  it("keeps unverified users three times the signup code ttl", () => {
    expect(RETENTION_MULTIPLIER).toBe(3);
    expect(retentionCutoffs(TTL, NOW).unverifiedUsersCreatedBefore).toEqual(
      secondsAgo(300),
    );
  });

  it("keeps throttle trails three times the longest block", () => {
    expect(retentionCutoffs(TTL, NOW).throttleFailedBefore).toEqual(
      secondsAgo(THROTTLE_MAX_BLOCK_SECONDS * 3),
    );
  });
});
