import type { EmailSender } from "./email/email-sender.js";
import type { AuthRepository } from "./plugins/app/auth/auth-repository.js";
import type { CheckPwnedPassword } from "./plugins/app/pwned-password.js";

export interface AppOptions {
  authRepository: AuthRepository;
  emailSender: EmailSender;
  checkPwnedPassword?: CheckPwnedPassword;
  enableDocsUi?: boolean;
}
