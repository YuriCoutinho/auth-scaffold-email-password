import { describe, expect, it } from "vitest";
import { verifySignupBodySchema } from "../../../src/features/verify-signup/schema.js";

describe("verifySignupBodySchema", () => {
  it("requires exactly six digits on verify", () => {
    expect(verifySignupBodySchema.safeParse({ code: "123456" }).success).toBe(
      true,
    );
    expect(verifySignupBodySchema.safeParse({ code: "12a456" }).success).toBe(
      false,
    );
  });
});
