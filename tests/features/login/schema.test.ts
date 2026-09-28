import { describe, expect, it } from "vitest";
import { loginBodySchema } from "../../../src/features/login/schema.js";

describe("loginBodySchema", () => {
  it("requires a non-empty password on login", () => {
    expect(
      loginBodySchema.safeParse({ email: "user@example.com", password: "" })
        .success,
    ).toBe(false);
  });
});
