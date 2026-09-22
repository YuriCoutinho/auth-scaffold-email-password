import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailProviderError } from "../../src/email/email-sender.js";
import { ResendEmailSender } from "../../src/email/resend-email-sender.js";

const message = {
  to: "user@example.com",
  subject: "s",
  html: "<p>h</p>",
  text: "t",
};
const makeSender = () =>
  new ResendEmailSender({ apiKey: "re_test", from: "App <a@b.com>" });
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("ResendEmailSender", () => {
  it("posts to resend and returns the provider message id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { id: "re_123" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(makeSender().send(message)).resolves.toEqual({
      providerMessageId: "re_123",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    expect(init.headers["Idempotency-Key"]).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.parse(init.body)).toEqual({
      from: "App <a@b.com>",
      to: "user@example.com",
      subject: "s",
      html: "<p>h</p>",
      text: "t",
    });
  });

  it("does not retry on 4xx and throws a typed error with status and body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, { message: "nope" }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await makeSender()
      .send(message)
      .catch((e) => e);
    expect(error).toBeInstanceOf(EmailProviderError);
    expect(error.status).toBe(403);
    expect(error.body).toContain("nope");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on 5xx with the same idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { message: "boom" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "re_ok" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(makeSender().send(message)).resolves.toEqual({
      providerMessageId: "re_ok",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map(
      ([, init]) => init.headers["Idempotency-Key"],
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it("retries on 429 and gives up after the second failure", async () => {
    // A fresh Response per attempt: a body can only be read once.
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse(429, { message: "slow down" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const error = await makeSender()
      .send(message)
      .catch((e) => e);
    expect(error).toBeInstanceOf(EmailProviderError);
    expect(error.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on network error", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(200, { id: "re_ok" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(makeSender().send(message)).resolves.toEqual({
      providerMessageId: "re_ok",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
