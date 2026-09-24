import { describe, expect, it } from "vitest";
import { renderPasswordChangedEmail } from "../../../../../src/plugins/app/auth/emails/password-changed.js";

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
