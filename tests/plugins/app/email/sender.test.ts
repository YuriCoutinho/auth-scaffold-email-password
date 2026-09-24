import { describe, expect, it } from "vitest";
import { EmailProviderError } from "../../../../src/plugins/app/email/sender.js";

const BODY = '{"message":"invalid recipient reset@example.com"}';

describe("EmailProviderError", () => {
  const error = new EmailProviderError("resend responded 422", {
    status: 422,
    body: BODY,
  });

  it("keeps the provider body readable for whoever asks for it", () => {
    expect(error.body).toBe(BODY);
  });

  it("keeps the provider body out of anything that copies own enumerable keys", () => {
    expect(Object.keys(error)).not.toContain("body");
    expect(JSON.stringify({ ...error })).not.toContain("reset@example.com");
  });

  it("still carries the status, which logs report on purpose", () => {
    expect(error.status).toBe(422);
  });

  it("keeps the message and the cause", () => {
    const cause = new Error("socket hang up");
    const wrapped = new EmailProviderError("resend unreachable", { cause });

    expect(wrapped.message).toBe("resend unreachable");
    expect(wrapped.cause).toBe(cause);
    expect(wrapped.name).toBe("EmailProviderError");
    expect(wrapped.body).toBeUndefined();
  });
});
