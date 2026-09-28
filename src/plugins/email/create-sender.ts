import type { Env } from "../../config/env.js";
import { FakeEmailSender } from "./drivers/fake.js";
import { MailpitEmailSender } from "./drivers/mailpit.js";
import { ResendEmailSender } from "./drivers/resend.js";
import type { EmailSender } from "./sender.js";

// parseEnv already guarantees these are set for the drivers that need them;
// this guard only turns an impossible state into a clear boot error.
function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required for the configured EMAIL_DRIVER`);
  }
  return value;
}

export function createEmailSender(env: Env): EmailSender {
  switch (env.EMAIL_DRIVER) {
    case "fake":
      return new FakeEmailSender();
    case "mailpit":
      return new MailpitEmailSender({
        from: required(env.EMAIL_FROM, "EMAIL_FROM"),
      });
    case "resend":
      return new ResendEmailSender({
        apiKey: required(env.RESEND_API_KEY, "RESEND_API_KEY"),
        from: required(env.EMAIL_FROM, "EMAIL_FROM"),
      });
  }
}
