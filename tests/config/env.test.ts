import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env.js";

describe("parseEnv", () => {
  it("accepts a valid development env and defaults PORT to 3000", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      NODE_ENV: "development",
    });
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.DATABASE_URL).toBe("postgres://u:p@localhost:5432/db");
  });

  it("defaults PORT to 3000 in test env", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      NODE_ENV: "test",
    });
    expect(env.PORT).toBe(3000);
  });

  it("rejects env without DATABASE_URL with a clear message", () => {
    expect(() => parseEnv({ NODE_ENV: "development" })).toThrowError(
      /DATABASE_URL/,
    );
  });

  it("rejects env without NODE_ENV", () => {
    expect(() =>
      parseEnv({ DATABASE_URL: "postgres://u:p@localhost:5432/db" }),
    ).toThrowError(/NODE_ENV/);
  });

  it("rejects an invalid NODE_ENV", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgres://u:p@localhost:5432/db",
        NODE_ENV: "staging",
      }),
    ).toThrowError(/NODE_ENV/);
  });

  it("rejects production env without PORT", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgres://u:p@localhost:5432/db",
        NODE_ENV: "production",
      }),
    ).toThrowError(/PORT/);
  });

  it("accepts production env with a valid PORT", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      NODE_ENV: "production",
      PORT: "8080",
    });
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe("production");
  });

  it("accumulates PORT and DATABASE_URL errors in production", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrowError(
      /DATABASE_URL[\s\S]*PORT|PORT[\s\S]*DATABASE_URL/,
    );
  });

  it("rejects a non-numeric PORT", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgres://u:p@localhost:5432/db",
        NODE_ENV: "development",
        PORT: "abc",
      }),
    ).toThrowError(/PORT/);
  });
});
