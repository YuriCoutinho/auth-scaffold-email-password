import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env.js";

describe("parseEnv", () => {
  it("aceita env válida e aplica defaults", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://u:p@localhost:5432/db" });
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.DATABASE_URL).toBe("postgres://u:p@localhost:5432/db");
  });

  it("rejeita env sem DATABASE_URL com mensagem clara", () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
  });

  it("rejeita PORT não numérica", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgres://u:p@localhost:5432/db",
        PORT: "abc",
      }),
    ).toThrowError(/PORT/);
  });
});
