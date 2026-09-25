import { describe, expect, it } from "vitest";
import { normalizeEmail } from "../../src/lib/email.js";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Joao@Example.COM ")).toBe("joao@example.com");
  });

  it("leaves a normalized address untouched", () => {
    expect(normalizeEmail("joao@example.com")).toBe("joao@example.com");
  });
});
