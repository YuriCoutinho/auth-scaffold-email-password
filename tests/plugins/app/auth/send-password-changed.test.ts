import { describe, expect, it, vi } from "vitest";
import { sendPasswordChanged } from "../../../../src/plugins/app/auth/send-password-changed.js";
import { EmailProviderError } from "../../../../src/plugins/app/email/sender.js";

describe("sendPasswordChanged", () => {
  it("resolves true and logs when the provider accepts the message", async () => {
    const emailSender = {
      send: vi.fn().mockResolvedValue({ providerMessageId: "abc" }),
    };
    const log = { info: vi.fn(), error: vi.fn() };

    await expect(
      sendPasswordChanged({ emailSender, log }, { to: "a@b.com", userId: 1 }),
    ).resolves.toBe(true);
    expect(emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@b.com" }),
    );
    expect(log.info).toHaveBeenCalled();
  });

  it("resolves false instead of throwing when the provider fails", async () => {
    const emailSender = {
      send: vi
        .fn()
        .mockRejectedValue(new EmailProviderError("boom", { status: 500 })),
    };
    const log = { info: vi.fn(), error: vi.fn() };

    await expect(
      sendPasswordChanged({ emailSender, log }, { to: "a@b.com", userId: 1 }),
    ).resolves.toBe(false);
    expect(log.error).toHaveBeenCalled();
  });

  it("never logs the recipient address", async () => {
    const emailSender = {
      send: vi.fn().mockResolvedValue({ providerMessageId: "abc" }),
    };
    const log = { info: vi.fn(), error: vi.fn() };

    await sendPasswordChanged(
      { emailSender, log },
      { to: "secret@example.com", userId: 1 },
    );

    expect(JSON.stringify(log.info.mock.calls)).not.toContain("secret@");
  });

  it("works without a logger", async () => {
    const emailSender = {
      send: vi.fn().mockResolvedValue({ providerMessageId: "abc" }),
    };

    await expect(
      sendPasswordChanged({ emailSender }, { to: "a@b.com", userId: 1 }),
    ).resolves.toBe(true);
  });
});
