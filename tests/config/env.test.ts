import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env.js";

const baseEnv = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  NODE_ENV: "development",
  EMAIL_DRIVER: "fake",
};

const productionEnv = {
  ...baseEnv,
  NODE_ENV: "production",
  PORT: "3000",
};

describe("parseEnv", () => {
  it("accepts a valid development env and defaults PORT to 3000", () => {
    const env = parseEnv({ ...baseEnv });
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.DATABASE_URL).toBe("postgres://u:p@localhost:5432/db");
  });

  it("defaults PORT to 3000 in test env", () => {
    const env = parseEnv({ ...baseEnv, NODE_ENV: "test" });
    expect(env.PORT).toBe(3000);
  });

  it("rejects env without DATABASE_URL with a clear message", () => {
    const { DATABASE_URL: _, ...env } = baseEnv;
    expect(() => parseEnv(env)).toThrowError(/DATABASE_URL/);
  });

  it("rejects env without NODE_ENV", () => {
    const { NODE_ENV: _, ...env } = baseEnv;
    expect(() => parseEnv(env)).toThrowError(/NODE_ENV/);
  });

  it("rejects an invalid NODE_ENV", () => {
    expect(() => parseEnv({ ...baseEnv, NODE_ENV: "staging" })).toThrowError(
      /NODE_ENV/,
    );
  });

  it("rejects production env without PORT", () => {
    expect(() => parseEnv({ ...baseEnv, NODE_ENV: "production" })).toThrowError(
      /PORT/,
    );
  });

  it("accepts production env with a valid PORT", () => {
    const env = parseEnv({
      ...productionEnv,
      PORT: "8080",
      FRONTEND_ORIGIN: "https://app.example.com",
    });
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe("production");
  });

  it("accumulates PORT and DATABASE_URL errors in production", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "production", EMAIL_DRIVER: "fake" }),
    ).toThrowError(/DATABASE_URL[\s\S]*PORT|PORT[\s\S]*DATABASE_URL/);
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => parseEnv({ ...baseEnv, PORT: "abc" })).toThrowError(/PORT/);
  });

  it("rejects when EMAIL_DRIVER is missing", () => {
    const { EMAIL_DRIVER: _, ...env } = baseEnv;
    expect(() => parseEnv(env)).toThrowError(/EMAIL_DRIVER/);
  });

  it("rejects an unknown EMAIL_DRIVER", () => {
    expect(() =>
      parseEnv({ ...baseEnv, EMAIL_DRIVER: "sendgrid" }),
    ).toThrowError(/EMAIL_DRIVER/);
  });

  it("requires EMAIL_FROM when EMAIL_DRIVER is mailpit", () => {
    expect(() =>
      parseEnv({ ...baseEnv, EMAIL_DRIVER: "mailpit" }),
    ).toThrowError(/EMAIL_FROM/);
  });

  it("requires EMAIL_FROM when EMAIL_DRIVER is resend", () => {
    expect(() =>
      parseEnv({ ...baseEnv, EMAIL_DRIVER: "resend", RESEND_API_KEY: "re_x" }),
    ).toThrowError(/EMAIL_FROM/);
  });

  it("accepts missing EMAIL_FROM when EMAIL_DRIVER is fake", () => {
    const env = parseEnv({ ...baseEnv });
    expect(env.EMAIL_DRIVER).toBe("fake");
    expect(env.EMAIL_FROM).toBeUndefined();
  });

  it("requires RESEND_API_KEY when EMAIL_DRIVER is resend", () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        EMAIL_DRIVER: "resend",
        EMAIL_FROM: "App <a@b.com>",
      }),
    ).toThrowError(/RESEND_API_KEY/);
  });

  it("accepts missing RESEND_API_KEY for fake and mailpit", () => {
    expect(parseEnv({ ...baseEnv }).RESEND_API_KEY).toBeUndefined();
    expect(
      parseEnv({
        ...baseEnv,
        EMAIL_DRIVER: "mailpit",
        EMAIL_FROM: "App <a@b.com>",
      }).RESEND_API_KEY,
    ).toBeUndefined();
  });

  it("parses a full resend config", () => {
    const env = parseEnv({
      ...baseEnv,
      EMAIL_DRIVER: "resend",
      EMAIL_FROM: "App <a@b.com>",
      RESEND_API_KEY: "re_test",
    });
    expect(env.EMAIL_DRIVER).toBe("resend");
    expect(env.EMAIL_FROM).toBe("App <a@b.com>");
    expect(env.RESEND_API_KEY).toBe("re_test");
  });

  it("accepts an absolute http origin", () => {
    const env = parseEnv({
      ...baseEnv,
      FRONTEND_ORIGIN: "http://localhost:5173",
    });
    expect(env.FRONTEND_ORIGIN).toBe("http://localhost:5173");
  });

  it("leaves the frontend origin optional outside production", () => {
    const env = parseEnv(baseEnv);
    expect(env.FRONTEND_ORIGIN).toBeUndefined();
  });

  it("treats an empty frontend origin as not configured outside production", () => {
    const env = parseEnv({ ...baseEnv, FRONTEND_ORIGIN: "" });
    expect(env.FRONTEND_ORIGIN).toBe("");
  });

  it("rejects an empty frontend origin in production", () => {
    expect(() =>
      parseEnv({ ...productionEnv, FRONTEND_ORIGIN: "" }),
    ).toThrowError(/FRONTEND_ORIGIN/);
  });

  it("requires the frontend origin in production", () => {
    expect(() => parseEnv(productionEnv)).toThrowError(/FRONTEND_ORIGIN/);
  });

  it("rejects a wildcard origin", () => {
    expect(() =>
      parseEnv({ ...productionEnv, FRONTEND_ORIGIN: "*" }),
    ).toThrowError(/FRONTEND_ORIGIN/);
  });

  it("rejects a wildcard host", () => {
    expect(() =>
      parseEnv({ ...productionEnv, FRONTEND_ORIGIN: "https://*.example.com" }),
    ).toThrowError(/FRONTEND_ORIGIN/);
  });

  it("rejects an origin carrying a path", () => {
    expect(() =>
      parseEnv({
        ...productionEnv,
        FRONTEND_ORIGIN: "https://app.example.com/app",
      }),
    ).toThrowError(/FRONTEND_ORIGIN/);
  });

  it("rejects an origin with a trailing slash", () => {
    expect(() =>
      parseEnv({
        ...productionEnv,
        FRONTEND_ORIGIN: "https://app.example.com/",
      }),
    ).toThrowError(/FRONTEND_ORIGIN/);
  });

  it("rejects a non-http protocol", () => {
    expect(() =>
      parseEnv({ ...productionEnv, FRONTEND_ORIGIN: "ftp://app.example.com" }),
    ).toThrowError(/FRONTEND_ORIGIN/);
  });
});
