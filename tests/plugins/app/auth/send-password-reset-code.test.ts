import { describe, expect, it, vi } from "vitest";
import { sendPasswordResetCode } from "../../../../src/plugins/app/auth/send-password-reset-code.js";
import { FakeEmailSender } from "../../../../src/plugins/app/email/drivers/fake.js";
import { EmailProviderError } from "../../../../src/plugins/app/email/sender.js";

function makeLog() {
  return { info: vi.fn(), error: vi.fn() };
}

describe("sendPasswordResetCode", () => {
  it("sends the code and resolves true", async () => {
    const emailSender = new FakeEmailSender();
    const log = makeLog();

    const delivered = await sendPasswordResetCode(
      { emailSender, log },
      { to: "reset@example.com", code: "123456", passwordResetId: 7 },
    );

    expect(delivered).toBe(true);
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]?.to).toBe("reset@example.com");
    expect(emailSender.sent[0]?.subject).toContain("123456");
  });

  it("resolves false instead of throwing when the provider fails", async () => {
    const emailSender = {
      send: vi
        .fn()
        .mockRejectedValue(new EmailProviderError("down", { status: 502 })),
    };
    const log = makeLog();

    const delivered = await sendPasswordResetCode(
      { emailSender, log },
      { to: "reset@example.com", code: "123456", passwordResetId: 7 },
    );

    expect(delivered).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });

  it("never logs the recipient address", async () => {
    const emailSender = new FakeEmailSender();
    const log = makeLog();

    await sendPasswordResetCode(
      { emailSender, log },
      { to: "reset@example.com", code: "123456", passwordResetId: 7 },
    );

    expect(JSON.stringify(log.info.mock.calls)).not.toContain(
      "reset@example.com",
    );
  });
});
