import { describe, expect, it } from "vitest";
import { resetPasswordBodySchema } from "../../../src/features/reset-password/schema.js";

describe("resetPasswordBodySchema", () => {
  it("requires six digits and a long enough password", () => {
    expect(
      resetPasswordBodySchema.safeParse({
        code: "123456",
        newPassword: "a perfectly fine passphrase",
      }).success,
    ).toBe(true);
    expect(
      resetPasswordBodySchema.safeParse({
        code: "12345",
        newPassword: "a perfectly fine passphrase",
      }).success,
    ).toBe(false);
    expect(
      resetPasswordBodySchema.safeParse({
        code: "12a456",
        newPassword: "a perfectly fine passphrase",
      }).success,
    ).toBe(false);
    expect(
      resetPasswordBodySchema.safeParse({
        code: "123456",
        newPassword: "a".repeat(14),
      }).success,
    ).toBe(false);
  });
});
