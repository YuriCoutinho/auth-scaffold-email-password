import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPwnedPasswordChecker } from "../../../../src/plugins/app/pwned-password/checker.js";

const PASSWORD = "correct horse battery staple";
const DIGEST = createHash("sha1").update(PASSWORD).digest("hex").toUpperCase();
const PREFIX = DIGEST.slice(0, 5);
const SUFFIX = DIGEST.slice(5);

function fakeFetch(body: string, ok = true) {
  return vi.fn().mockResolvedValue({ ok, text: async () => body });
}

describe("createPwnedPasswordChecker", () => {
  it("returns true when the suffix appears in the range response", async () => {
    const fetchFn = fakeFetch(`00000AAAA:2\r\n${SUFFIX}:1523\r\nFFFFFFFFF:1`);
    const check = createPwnedPasswordChecker({ fetchFn });
    expect(await check(PASSWORD)).toBe(true);
  });

  it("returns false when the suffix is absent", async () => {
    const check = createPwnedPasswordChecker({
      fetchFn: fakeFetch("00000AAAA:2"),
    });
    expect(await check(PASSWORD)).toBe(false);
  });

  it("sends only the 5-char prefix, never the full hash", async () => {
    const fetchFn = fakeFetch("");
    await createPwnedPasswordChecker({ fetchFn })(PASSWORD);
    const url = fetchFn.mock.calls[0]?.[0] as string;
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    expect(url).not.toContain(SUFFIX);
  });

  it("fails open when the request rejects", async () => {
    const onError = vi.fn();
    const check = createPwnedPasswordChecker({
      fetchFn: vi.fn().mockRejectedValue(new Error("network down")),
      onError,
    });
    expect(await check(PASSWORD)).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("fails open on non-2xx responses", async () => {
    const check = createPwnedPasswordChecker({ fetchFn: fakeFetch("", false) });
    expect(await check(PASSWORD)).toBe(false);
  });
});
