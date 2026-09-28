import { describe, expect, it } from "vitest";
import { signupBodySchema } from "../../../src/features/signup/schema.js";

describe("signupBodySchema", () => {
  it("accepts a valid signup body and rejects a short password", () => {
    expect(
      signupBodySchema.safeParse({
        email: "user@example.com",
        password: "a perfectly fine passphrase",
      }).success,
    ).toBe(true);
    expect(
      signupBodySchema.safeParse({
        email: "user@example.com",
        password: "short",
      }).success,
    ).toBe(false);
  });
});
