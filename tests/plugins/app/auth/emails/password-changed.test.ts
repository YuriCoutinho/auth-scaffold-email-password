import { describe, expect, it } from "vitest";
import { renderPasswordChangedEmail } from "../../../../../src/plugins/app/auth/emails/password-changed.js";

describe("renderPasswordChangedEmail", () => {
  it("states that the password changed in the subject", () => {
    expect(renderPasswordChangedEmail().subject).toBe(
      "Your password was changed",
    );
  });

  it("tells the reader what to do when it was not them", () => {
    const { text, html } = renderPasswordChangedEmail();

    expect(text).toContain("contact support");
    expect(html).toContain("contact support");
  });

  it("says every other device was signed out", () => {
    expect(renderPasswordChangedEmail().text).toContain("signed out");
  });
});
