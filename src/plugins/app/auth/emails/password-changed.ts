export interface PasswordChangedEmailContent {
  subject: string;
  html: string;
  text: string;
}

// No link, even though the recovery flow now exists: a security notice that
// trains the reader to click links inside it is the habit phishing exploits.
// With no dynamic value, the template has nothing to escape.
export function renderPasswordChangedEmail(): PasswordChangedEmailContent {
  const notice =
    "Every other device was signed out. If this wasn't you, reset your password from the sign-in page right away to take the account back.";

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
