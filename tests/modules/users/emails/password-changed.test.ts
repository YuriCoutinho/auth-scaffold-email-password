import { describe, expect, it, vi } from "vitest";
import {
  renderPasswordChangedEmail,
  sendPasswordChanged,
} from "../../../../src/modules/users/emails/password-changed.js";
import { EmailProviderError } from "../../../../src/plugins/email/sender.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("renderPasswordChangedEmail", () => {
  it("states that the password changed in the subject", () => {
    expect(renderPasswordChangedEmail().subject).toBe(
      "Your password was changed",
    );
  });

  it("points at the reset flow and carries no link", () => {
    const content = renderPasswordChangedEmail();

    expect(content.text).toContain("reset your password");
    expect(content.text).not.toContain("contact support");
    expect(content.html).not.toContain("<a ");
  });

  it("says every other device was signed out", () => {
    expect(renderPasswordChangedEmail().text).toContain("signed out");
  });
});

describe("sendPasswordChanged", () => {
  it("resolves true and logs when the provider accepts the message", async () => {
    const emailSender = {
      send: vi.fn().mockResolvedValue({ providerMessageId: "abc" }),
    };
    const log = { info: vi.fn(), error: vi.fn() };

    await expect(
      sendPasswordChanged(
        { emailSender, log },
        { to: "a@b.com", userId: USER_ID },
      ),
    ).resolves.toBe(true);
    expect(emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@b.com" }),
    );
    expect(log.info).toHaveBeenCalledWith(
      { userId: USER_ID, providerMessageId: "abc" },
      "password changed email sent",
    );
  });

  it("resolves false instead of throwing when the provider fails", async () => {
    const emailSender = {
      send: vi
        .fn()
        .mockRejectedValue(new EmailProviderError("boom", { status: 500 })),
    };
    const log = { info: vi.fn(), error: vi.fn() };

    await expect(
      sendPasswordChanged(
        { emailSender, log },
        { to: "a@b.com", userId: USER_ID },
      ),
    ).resolves.toBe(false);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, providerStatus: 500 }),
      "password changed email delivery failed",
    );
  });

  it("never logs the recipient address", async () => {
    const emailSender = {
      send: vi.fn().mockResolvedValue({ providerMessageId: "abc" }),
    };
    const log = { info: vi.fn(), error: vi.fn() };

    await sendPasswordChanged(
      { emailSender, log },
      { to: "secret@example.com", userId: USER_ID },
    );

    expect(JSON.stringify(log.info.mock.calls)).not.toContain("secret@");
  });

  it("works without a logger", async () => {
    const emailSender = {
      send: vi.fn().mockResolvedValue({ providerMessageId: "abc" }),
    };

    await expect(
      sendPasswordChanged({ emailSender }, { to: "a@b.com", userId: USER_ID }),
    ).resolves.toBe(true);
  });
});
