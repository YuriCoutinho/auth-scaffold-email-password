import { describe, expect, it } from "vitest";
import { currentUserResponseSchema } from "../../../src/features/me/schema.js";

describe("currentUserResponseSchema", () => {
  it("requires a uuid id and an email", () => {
    expect(
      currentUserResponseSchema.safeParse({
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "a@b.com",
        },
      }).success,
    ).toBe(true);
    expect(
      currentUserResponseSchema.safeParse({
        user: { id: "nope", email: "a@b.com" },
      }).success,
    ).toBe(false);
    expect(
      currentUserResponseSchema.safeParse({
        user: { id: "11111111-1111-4111-8111-111111111111" },
      }).success,
    ).toBe(false);
  });
});
