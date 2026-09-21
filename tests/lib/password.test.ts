import { describe, expect, it } from "vitest";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "../../src/lib/password.js";

describe("hashPassword", () => {
  it("produces an argon2id hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
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

describe("DUMMY_PASSWORD_HASH", () => {
  it("is a valid argon2 hash that matches no real password", async () => {
    await expect(
      verifyPassword(DUMMY_PASSWORD_HASH, "any-password"),
    ).resolves.toBe(false);
  });
});
