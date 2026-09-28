import { describe, expect, it, vi } from "vitest";

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
}));

import type { Env } from "../../../src/config/env.js";
import { createEmailSender } from "../../../src/plugins/email/create-sender.js";
import { FakeEmailSender } from "../../../src/plugins/email/drivers/fake.js";
import { MailpitEmailSender } from "../../../src/plugins/email/drivers/mailpit.js";
import { ResendEmailSender } from "../../../src/plugins/email/drivers/resend.js";

const baseEnv: Env = {
  DATABASE_URL: "postgres://x",
  PORT: 3000,
  NODE_ENV: "test",
  EMAIL_DRIVER: "fake",
  HMAC_SECRET: "x".repeat(32),
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
