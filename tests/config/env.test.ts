import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env.js";

describe("parseEnv", () => {
  it("accepts a valid env and applies defaults", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://u:p@localhost:5432/db" });
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.DATABASE_URL).toBe("postgres://u:p@localhost:5432/db");
  });

  it("rejects env without DATABASE_URL with a clear message", () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
  });

  it("rejects a non-numeric PORT", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgres://u:p@localhost:5432/db",
        PORT: "abc",
      }),
    ).toThrowError(/PORT/);
  });
});
