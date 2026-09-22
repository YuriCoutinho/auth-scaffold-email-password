import type { EmailSender } from "./email/email-sender.js";
import type { CheckPwnedPassword } from "./lib/pwned-password.js";
import type { AuthRepository } from "./plugins/app/auth/auth-repository.js";

export interface AppOptions {
  authRepository: AuthRepository;
  emailSender: EmailSender;
  checkPwnedPassword: CheckPwnedPassword;
  enableDocsUi?: boolean;
}
