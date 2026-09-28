import { describe, expect, it } from "vitest";
import { forgotPasswordBodySchema } from "../../../src/features/forgot-password/schema.js";

describe("forgotPasswordBodySchema", () => {
  it("accepts a valid address and rejects a malformed one", () => {
    expect(
      forgotPasswordBodySchema.safeParse({ email: "user@example.com" }).success,
    ).toBe(true);
    expect(
      forgotPasswordBodySchema.safeParse({ email: "not-an-email" }).success,
    ).toBe(false);
    expect(
      forgotPasswordBodySchema.safeParse({
        email: `${"a".repeat(250)}@example.com`,
      }).success,
    ).toBe(false);
  });
});
