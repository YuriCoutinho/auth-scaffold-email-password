import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import pwnedPasswordPlugin from "../../../../src/plugins/app/pwned-password/index.js";

describe("pwned-password plugin", () => {
  it("uses the checker from the options when given", async () => {
    const checkPwnedPassword = vi.fn().mockResolvedValue(true);
    const app = Fastify();
    await app.register(pwnedPasswordPlugin, { checkPwnedPassword });
    await app.ready();
    expect(await app.checkPwnedPassword("x")).toBe(true);
    expect(checkPwnedPassword).toHaveBeenCalledWith("x");
    await app.close();
  });

  it("builds a fail-open checker that logs through fastify.log otherwise", async () => {
    const app = Fastify();
    const warn = vi.spyOn(app.log, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await app.register(pwnedPasswordPlugin, {});
    await app.ready();
    expect(await app.checkPwnedPassword("x")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    await app.close();
  });
});
