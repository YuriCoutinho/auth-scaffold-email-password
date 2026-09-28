import { describe, expect, it, vi } from "vitest";
import { createMe } from "../../../src/features/me/use-case.js";

describe("me", () => {
  it("returns the user the port resolves", async () => {
    const findUser = vi.fn().mockResolvedValue({ id: "1", email: "a@b.com" });
    const me = createMe({ findUser });

    await expect(me("1")).resolves.toEqual({ id: "1", email: "a@b.com" });
    expect(findUser).toHaveBeenCalledExactlyOnceWith("1");
  });

  it("resolves undefined when the port finds no user", async () => {
    const me = createMe({ findUser: vi.fn().mockResolvedValue(undefined) });

    await expect(me("missing")).resolves.toBeUndefined();
  });
});
