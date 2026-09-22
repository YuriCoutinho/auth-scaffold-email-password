import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { FakeEmailSender } from "../../../../src/plugins/app/email/drivers/fake.js";
import emailSenderPlugin from "../../../../src/plugins/app/email/index.js";
import { TEST_ENV } from "../../../helpers/app-options.js";

describe("email plugin", () => {
  it("uses the sender from the options when given", async () => {
    const emailSender = {
      send: vi.fn().mockResolvedValue({ providerMessageId: "msg-1" }),
    };
    const app = Fastify();
    await app.register(emailSenderPlugin, { config: TEST_ENV, emailSender });
    await app.ready();
    expect(app.emailSender).toBe(emailSender);
    await app.close();
  });

  it("builds the sender from the config driver otherwise", async () => {
    const app = Fastify();
    await app.register(emailSenderPlugin, { config: TEST_ENV });
    await app.ready();
    expect(app.emailSender).toBeInstanceOf(FakeEmailSender);
    await app.close();
  });
});
