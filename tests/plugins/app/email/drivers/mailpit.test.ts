import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
}));

import nodemailer from "nodemailer";
import { MailpitEmailSender } from "../../../../../src/plugins/app/email/drivers/mailpit.js";

beforeEach(() => {
  sendMail.mockReset().mockResolvedValue({ messageId: "<mailpit-1@local>" });
});

describe("MailpitEmailSender", () => {
  it("creates an smtp transport against localhost:1025", () => {
    new MailpitEmailSender({ from: "App <a@b.com>" });
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: "localhost",
      port: 1025,
      secure: false,
    });
  });

  it("sends the message with from, subject, html and text", async () => {
    const sender = new MailpitEmailSender({ from: "App <a@b.com>" });
    const result = await sender.send({
      to: "u@e.com",
      subject: "s",
      html: "<p>h</p>",
      text: "t",
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "App <a@b.com>",
      to: "u@e.com",
      subject: "s",
      html: "<p>h</p>",
      text: "t",
    });
    expect(result).toEqual({ providerMessageId: "<mailpit-1@local>" });
  });
});
