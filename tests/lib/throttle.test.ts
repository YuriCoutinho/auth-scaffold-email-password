import { describe, expect, it } from "vitest";
import {
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
