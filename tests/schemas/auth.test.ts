import { describe, expect, it } from "vitest";
import { signupBodySchema } from "../../src/features/signup/schema.js";
import {
  changePasswordBodySchema,
  loginBodySchema,
  messageSchema,
  resetPasswordBodySchema,
  verifyCodeBodySchema,
} from "../../src/schemas/auth.js";

describe("auth schemas", () => {
  it("requires a non-empty password on login", () => {
    expect(
      loginBodySchema.safeParse({ email: "user@example.com", password: "" })
        .success,
    ).toBe(false);
  });

  it("requires exactly six digits on verify", () => {
    expect(verifyCodeBodySchema.safeParse({ code: "123456" }).success).toBe(
      true,
    );
    expect(verifyCodeBodySchema.safeParse({ code: "12a456" }).success).toBe(
      false,
    );
  });

  it("describes a message envelope", () => {
    expect(messageSchema.safeParse({ message: "ok" }).success).toBe(true);
  });
});

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
