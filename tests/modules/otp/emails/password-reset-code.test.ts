import { describe, expect, it } from "vitest";
import { renderPasswordResetCodeEmail } from "../../../../src/modules/otp/emails/password-reset-code.js";

describe("renderPasswordResetCodeEmail", () => {
  const content = renderPasswordResetCodeEmail({
    code: "123456",
    ttlMinutes: 15,
  });

  it("puts the code in the subject and in both bodies", () => {
    expect(content.subject).toContain("123456");
    expect(content.html).toContain("123456");
    expect(content.text).toContain("123456");
  });

  it("states the expiry in both bodies", () => {
    expect(content.html).toContain("15 minutes");
    expect(content.text).toContain("15 minutes");
  });

  it("talks about resetting a password, not about confirming an address", () => {
    expect(content.text).toContain("reset");
    expect(content.text).not.toContain("confirm your email address");
  });

  it("tells a reader who did not ask for it to ignore the email", () => {
    expect(content.text).toContain("ignore this email");
  });

  it("carries no link, so the flow never teaches clicking one", () => {
    expect(content.html).not.toContain("<a ");
    expect(content.html).not.toContain("http");
  });
});
