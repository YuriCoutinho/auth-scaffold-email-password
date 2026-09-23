import { describe, expect, it } from "vitest";
import { sessionParamsSchema } from "../../src/schemas/sessions.js";

describe("sessionParamsSchema", () => {
  it("accepts a uuid", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(sessionParamsSchema.parse({ sessionId: id })).toEqual({
      sessionId: id,
    });
  });

  it("rejects anything that is not a uuid", () => {
    expect(() => sessionParamsSchema.parse({ sessionId: "current" })).toThrow();
    expect(() => sessionParamsSchema.parse({ sessionId: "42" })).toThrow();
  });
});
