import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/password.js";

describe("hashPassword", () => {
  it("produces an argon2id hash with the OWASP baseline parameters", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).toContain("m=19456");
    expect(hash).toContain("t=2");
    expect(hash).toContain("p=1");
  });

  it("salts each hash, so equal passwords produce different hashes", async () => {
    const first = await hashPassword("same-password");
    const second = await hashPassword("same-password");
    expect(first).not.toBe(second);
  });
});

describe("verifyPassword", () => {
  it("accepts the original password", async () => {
    const hash = await hashPassword("s3cret!");
    await expect(verifyPassword(hash, "s3cret!")).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret!");
    await expect(verifyPassword(hash, "s3cret?")).resolves.toBe(false);
  });
});
