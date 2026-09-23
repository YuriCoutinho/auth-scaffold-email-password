import { describe, expect, it } from "vitest";
import {
  currentUserResponseSchema,
  loginBodySchema,
  messageSchema,
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
