import { describe, expect, it } from "vitest";
import {
  DEFAULT_TTL,
  expiresAt,
  hasExpired,
  isExpired,
  issuedAfter,
  resolveTtl,
} from "../../src/lib/ttl.js";

const NOW = new Date("2026-09-24T12:00:00Z");

describe("resolveTtl", () => {
  it("returns the defaults when nothing is overridden", () => {
    expect(resolveTtl()).toEqual(DEFAULT_TTL);
    expect(resolveTtl({})).toEqual(DEFAULT_TTL);
  });

  it("uses thirty days for sessions and fifteen minutes for codes", () => {
    expect(DEFAULT_TTL).toEqual({
      sessionSeconds: 30 * 24 * 60 * 60,
      signupCodeSeconds: 15 * 60,
      passwordResetCodeSeconds: 15 * 60,
    });
  });

  it("overrides only the fields given", () => {
    expect(resolveTtl({ signupCodeSeconds: 60 })).toEqual({
      ...DEFAULT_TTL,
      signupCodeSeconds: 60,
    });
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["non-integer", 1.5],
  ])("rejects a %s value", (_name, value) => {
    expect(() => resolveTtl({ sessionSeconds: value })).toThrow();
  });
});

describe("expiresAt", () => {
  it("adds the ttl to the issue instant", () => {
    expect(expiresAt(NOW, 60)).toEqual(new Date("2026-09-24T12:01:00Z"));
  });
});

describe("hasExpired", () => {
  it("is false before the expiry", () => {
    expect(hasExpired(NOW, new Date(NOW.getTime() - 1))).toBe(false);
  });

  it("is true exactly at the expiry", () => {
    expect(hasExpired(NOW, NOW)).toBe(true);
  });
});

describe("isExpired", () => {
  it("is false before the expiry", () => {
    expect(isExpired(NOW, 60, new Date(NOW.getTime() + 59_999))).toBe(false);
  });

  it("is true exactly at the expiry", () => {
    expect(isExpired(NOW, 60, new Date(NOW.getTime() + 60_000))).toBe(true);
  });
});

describe("issuedAfter", () => {
  it("returns the oldest issue instant still valid at now", () => {
    const cutoff = issuedAfter(60, NOW);
    expect(cutoff).toEqual(new Date("2026-09-24T11:59:00Z"));
    expect(isExpired(cutoff, 60, NOW)).toBe(true);
    expect(isExpired(new Date(cutoff.getTime() + 1), 60, NOW)).toBe(false);
  });
});
