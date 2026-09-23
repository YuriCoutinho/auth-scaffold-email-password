// The outbox stores this name on the row, and both the retry policy and the
// give-up handler are chosen by it.
export const PASSWORD_CHANGED_EMAIL_TYPE = "password_changed";

export interface PasswordChangedEmailContent {
  subject: string;
  html: string;
  text: string;
}

// No link and no parameters: the password recovery flow does not exist yet,
// so a "this wasn't me" action would have nowhere to go, and a template with
// no dynamic value is a template with nothing to escape.
export function renderPasswordChangedEmail(): PasswordChangedEmailContent {
  const notice =
    "Every other device was signed out. If this wasn't you, contact support right away.";

  return {
    subject: "Your password was changed",
    html: [
      '<div style="max-width: 480px; margin: 0 auto; padding: 24px; font-family: Arial, Helvetica, sans-serif; color: #1a1a1a;">',
      '  <p style="margin: 0 0 16px;">The password for your account was just changed.</p>',
      `  <p style="margin: 0; color: #555555;">${notice}</p>`,
      "</div>",
    ].join("\n"),
    text: ["The password for your account was just changed.", "", notice].join(
      "\n",
    ),
  };
}
