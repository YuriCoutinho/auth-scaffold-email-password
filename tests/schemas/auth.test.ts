import { describe, expect, it } from "vitest";
import {
  changePasswordBodySchema,
  currentUserResponseSchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  messageSchema,
  resetPasswordBodySchema,
  signupBodySchema,
  verifyCodeBodySchema,
} from "../../src/schemas/auth.js";

describe("auth schemas", () => {
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

  it("currentUserResponseSchema requires a uuid public id and an email", () => {
    expect(
      currentUserResponseSchema.safeParse({
        user: {
          publicId: "11111111-1111-4111-8111-111111111111",
          email: "a@b.com",
        },
      }).success,
    ).toBe(true);
    expect(
      currentUserResponseSchema.safeParse({
        user: { publicId: "nope", email: "a@b.com" },
      }).success,
    ).toBe(false);
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
