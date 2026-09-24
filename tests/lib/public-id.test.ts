import { describe, expect, it } from "vitest";
import { generatePublicId } from "../../src/lib/public-id.js";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generatePublicId", () => {
  it("returns a version 4 uuid", () => {
    expect(generatePublicId()).toMatch(UUID_V4);
  });

  it("never repeats a value", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generatePublicId());
    }
    expect(ids.size).toBe(1000);
  });
});
