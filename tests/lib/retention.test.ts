import { describe, expect, it } from "vitest";
import { retentionCutoffs } from "../../src/lib/retention.js";
import { THROTTLE_MAX_BLOCK_SECONDS } from "../../src/lib/throttle.js";

const NOW = new Date("2026-09-24T12:00:00Z");

describe("retentionCutoffs", () => {
  it("drops sessions and codes the moment they expire", () => {
    expect(retentionCutoffs(NOW).expiredAt).toEqual(NOW);
  });

  it("drops a throttle trail once it has gone cold", () => {
    expect(retentionCutoffs(NOW).throttleFailedBefore).toEqual(
      new Date(NOW.getTime() - THROTTLE_MAX_BLOCK_SECONDS * 1000),
    );
  });
});
