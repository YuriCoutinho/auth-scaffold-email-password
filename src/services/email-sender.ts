export interface SignupEmailMessage {
  to: string;
  code: string;
}

export type EmailSender = (message: SignupEmailMessage) => Promise<void>;

// No-op stub: real implementations (fake/Mailpit/Resend) arrive in ENG-55.
export const noopEmailSender: EmailSender = async () => {};
