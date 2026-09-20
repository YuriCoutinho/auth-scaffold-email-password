import { describe, expect, it } from "vitest";
import { FakeEmailSender } from "../../../src/services/email/fake-email-sender.js";

describe("FakeEmailSender", () => {
  it("stores sent messages and returns sequential ids", async () => {
    const sender = new FakeEmailSender();
    const msg = { to: "a@b.com", subject: "s", html: "<p>h</p>", text: "t" };
    await expect(sender.send(msg)).resolves.toEqual({
      providerMessageId: "fake-1",
    });
    await expect(sender.send(msg)).resolves.toEqual({
      providerMessageId: "fake-2",
    });
    expect(sender.sent).toEqual([msg, msg]);
  });
});
