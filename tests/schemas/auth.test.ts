import { describe, expect, it } from "vitest";
import {
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

  it("describes a message envelope", () => {
    expect(messageSchema.safeParse({ message: "ok" }).success).toBe(true);
  });
});
