import { describe, expect, it, vi } from "vitest";

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
}));

import type { Env } from "../../src/config/env.js";
import { createEmailSender } from "../../src/email/create-email-sender.js";
import { FakeEmailSender } from "../../src/email/fake-email-sender.js";
import { MailpitEmailSender } from "../../src/email/mailpit-email-sender.js";
import { ResendEmailSender } from "../../src/email/resend-email-sender.js";

const baseEnv: Env = {
  DATABASE_URL: "postgres://x",
  PORT: 3000,
  NODE_ENV: "test",
  EMAIL_DRIVER: "fake",
};

describe("createEmailSender", () => {
  it("builds the fake sender", () => {
    expect(createEmailSender(baseEnv)).toBeInstanceOf(FakeEmailSender);
  });

  it("builds the mailpit sender", () => {
    expect(
      createEmailSender({
        ...baseEnv,
        EMAIL_DRIVER: "mailpit",
        EMAIL_FROM: "App <a@b.com>",
      }),
    ).toBeInstanceOf(MailpitEmailSender);
  });

  it("builds the resend sender", () => {
    expect(
      createEmailSender({
        ...baseEnv,
        EMAIL_DRIVER: "resend",
        EMAIL_FROM: "App <a@b.com>",
        RESEND_API_KEY: "re_x",
      }),
    ).toBeInstanceOf(ResendEmailSender);
  });
});
