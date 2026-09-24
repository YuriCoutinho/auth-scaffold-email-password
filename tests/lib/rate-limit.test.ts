import { describe, expect, it } from "vitest";
import { RATE_LIMITS, rateLimitFor } from "../../src/lib/rate-limit.js";

describe("rateLimitFor", () => {
  it("falls back to the shipped policy", () => {
    expect(rateLimitFor("login")).toEqual(RATE_LIMITS.login);
  });

  it("prefers an override for that scope only", () => {
    const overrides = { login: { max: 2, timeWindow: "1 minute" } };
    expect(rateLimitFor("login", overrides)).toEqual(overrides.login);
    expect(rateLimitFor("signup", overrides)).toEqual(RATE_LIMITS.signup);
  });

  it("keeps login tighter than signup", () => {
    expect(RATE_LIMITS.login).toEqual({ max: 10, timeWindow: "1 minute" });
    expect(RATE_LIMITS.signup).toEqual({ max: 20, timeWindow: "1 hour" });
  });
});
