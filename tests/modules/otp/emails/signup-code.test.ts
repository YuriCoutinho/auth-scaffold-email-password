import { describe, expect, it } from "vitest";
import { renderSignupCodeEmail } from "../../../../src/modules/otp/emails/signup-code.js";

describe("renderSignupCodeEmail", () => {
  const content = renderSignupCodeEmail({ code: "123456", ttlMinutes: 15 });

  it("puts the code in the subject", () => {
    expect(content.subject).toBe("Your verification code: 123456");
  });

  it("includes code, expiry and ignore note in the html", () => {
    expect(content.html).toContain("123456");
    expect(content.html).toContain("15 minutes");
    expect(content.html).toContain("you can safely ignore this email");
  });

  it("includes code, expiry and ignore note in the plain text", () => {
    expect(content.text).toContain("123456");
    expect(content.text).toContain("15 minutes");
    expect(content.text).toContain("you can safely ignore this email");
  });

  it("has no images or links in the html", () => {
    expect(content.html).not.toContain("<img");
    expect(content.html).not.toContain("href=");
  });
});
