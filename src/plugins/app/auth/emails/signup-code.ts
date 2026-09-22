export interface SignupCodeEmailContent {
  subject: string;
  html: string;
  text: string;
}

// The OTP code is the only dynamic value and is always generated digits,
// so no user-provided data reaches this template (nothing to escape).
export function renderSignupCodeEmail(params: {
  code: string;
  ttlMinutes: number;
}): SignupCodeEmailContent {
  const { code, ttlMinutes } = params;
  const ignoreNote =
    "If you didn't request this, you can safely ignore this email.";

  return {
    subject: `Your verification code: ${code}`,
    html: [
      '<div style="max-width: 480px; margin: 0 auto; padding: 24px; font-family: Arial, Helvetica, sans-serif; color: #1a1a1a;">',
      '  <p style="margin: 0 0 16px;">Use this code to confirm your email address:</p>',
      `  <p style="margin: 0 0 16px; font-size: 32px; font-weight: bold; letter-spacing: 4px;">${code}</p>`,
      `  <p style="margin: 0 0 16px;">This code expires in ${ttlMinutes} minutes.</p>`,
      `  <p style="margin: 0; color: #555555;">${ignoreNote}</p>`,
      "</div>",
    ].join("\n"),
    text: [
      "Use this code to confirm your email address:",
      "",
      code,
      "",
      `This code expires in ${ttlMinutes} minutes.`,
      ignoreNote,
    ].join("\n"),
  };
}
