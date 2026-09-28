import { describe, expect, it } from "vitest";
import { changePasswordBodySchema } from "../../../src/features/change-password/schema.js";
import { signupBodySchema } from "../../../src/features/signup/schema.js";

describe("changePasswordBodySchema", () => {
  it("accepts a current password and a strong new password", () => {
    const result = changePasswordBodySchema.safeParse({
      currentPassword: "old-password-here",
      newPassword: "a-brand-new-long-password",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a new password shorter than 15 characters", () => {
    const result = changePasswordBodySchema.safeParse({
      currentPassword: "old-password-here",
      newPassword: "short",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a new password longer than 128 characters", () => {
    const result = changePasswordBodySchema.safeParse({
      currentPassword: "old-password-here",
      newPassword: "a".repeat(129),
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty current password", () => {
    const result = changePasswordBodySchema.safeParse({
      currentPassword: "",
      newPassword: "a-brand-new-long-password",
    });

    expect(result.success).toBe(false);
  });

  it("applies the same strength rule the signup body uses", () => {
    const weak = "short";

    expect(
      signupBodySchema.safeParse({ email: "a@b.com", password: weak }).success,
    ).toBe(
      changePasswordBodySchema.safeParse({
        currentPassword: "old-password-here",
        newPassword: weak,
      }).success,
    );
  });
});
