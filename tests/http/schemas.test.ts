import { describe, expect, it } from "vitest";
import { messageSchema } from "../../src/http/schemas.js";

describe("messageSchema", () => {
  it("describes a message envelope", () => {
    expect(messageSchema.safeParse({ message: "ok" }).success).toBe(true);
  });
});
