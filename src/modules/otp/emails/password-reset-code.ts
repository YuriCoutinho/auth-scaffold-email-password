export interface PasswordResetCodeEmailContent {
  subject: string;
  html: string;
  text: string;
}

// Its own template rather than a parameter on the signup one: the signup copy
// is about confirming an address, which is the wrong thing to say here. The
// code is the only dynamic value and is always generated digits, so no
// user-provided data reaches this template.
export function renderPasswordResetCodeEmail(params: {
  code: string;
  ttlMinutes: number;
}): PasswordResetCodeEmailContent {
  const { code, ttlMinutes } = params;
  const ignoreNote =
    "If you didn't request this, you can safely ignore this email. Your password has not changed.";

  return {
    subject: `Your password reset code: ${code}`,
    html: [
      '<div style="max-width: 480px; margin: 0 auto; padding: 24px; font-family: Arial, Helvetica, sans-serif; color: #1a1a1a;">',
      '  <p style="margin: 0 0 16px;">Use this code to reset your password:</p>',
      `  <p style="margin: 0 0 16px; font-size: 32px; font-weight: bold; letter-spacing: 4px;">${code}</p>`,
      `  <p style="margin: 0 0 16px;">This code expires in ${ttlMinutes} minutes.</p>`,
      `  <p style="margin: 0; color: #555555;">${ignoreNote}</p>`,
      "</div>",
    ].join("\n"),
    text: [
      "Use this code to reset your password:",
      "",
      code,
      "",
      `This code expires in ${ttlMinutes} minutes.`,
      ignoreNote,
    ].join("\n"),
  };
}
