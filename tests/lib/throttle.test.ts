import { describe, expect, it } from "vitest";
import {
  blockedUntil,
  blockSecondsForFailures,
  THROTTLE_MAX_BLOCK_SECONDS,
} from "../../src/lib/throttle.js";

describe("blockSecondsForFailures", () => {
  it("lets the first three consecutive failures through with no block", () => {
    expect(blockSecondsForFailures(1)).toBe(0);
    expect(blockSecondsForFailures(2)).toBe(0);
    expect(blockSecondsForFailures(3)).toBe(0);
  });

  it("grows the window five-fold from one minute", () => {
    expect(blockSecondsForFailures(4)).toBe(60);
    expect(blockSecondsForFailures(5)).toBe(300);
    expect(blockSecondsForFailures(6)).toBe(1500);
  });

  it("caps the window at one hour", () => {
    expect(blockSecondsForFailures(7)).toBe(THROTTLE_MAX_BLOCK_SECONDS);
    expect(blockSecondsForFailures(50)).toBe(THROTTLE_MAX_BLOCK_SECONDS);
    expect(THROTTLE_MAX_BLOCK_SECONDS).toBe(3600);
  });
});

describe("blockedUntil", () => {
  const LAST = new Date("2026-09-24T12:00:00Z");

  it("is null while the failures are still free", () => {
    expect(blockedUntil(3, LAST)).toBeNull();
  });

  it("adds the block window to the last failure", () => {
    expect(blockedUntil(4, LAST)).toEqual(new Date("2026-09-24T12:01:00Z"));
    expect(blockedUntil(50, LAST)).toEqual(new Date("2026-09-24T13:00:00Z"));
  });
});
