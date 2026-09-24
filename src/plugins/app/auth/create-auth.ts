import type { FastifyBaseLogger } from "fastify";
import type { CredentialThrottle } from "../credential-throttle/create-credential-throttle.js";
import type { EmailSender } from "../email/sender.js";
import type { CheckPwnedPassword } from "../pwned-password/checker.js";
import type { SessionRepository } from "../sessions/repository.js";
import { createAuthenticateService } from "./authenticate.js";
import { createChangePasswordService } from "./change-password.js";
import { createForgotPasswordService } from "./forgot-password.js";
import { createLoginService } from "./login.js";
import type { AuthRepository } from "./repository.js";
import { createResendCodeService } from "./resend-code.js";
import { createResetPasswordService } from "./reset-password.js";
import { createSignupService } from "./signup.js";
import { createVerifyCodeService } from "./verify-code.js";

export interface AuthDeps {
  repository: AuthRepository;
  sessionRepository: SessionRepository;
  emailSender: EmailSender;
  checkPwnedPassword: CheckPwnedPassword;
  credentialThrottle: CredentialThrottle;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createAuth(deps: AuthDeps) {
  const shared = {
    repo: deps.repository,
    ...(deps.log ? { log: deps.log } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  };
  const { signup } = createSignupService({
    ...shared,
    emailSender: deps.emailSender,
    checkPwnedPassword: deps.checkPwnedPassword,
  });
  const { forgotPassword } = createForgotPasswordService({
    ...shared,
    emailSender: deps.emailSender,
  });
  const { resendCode } = createResendCodeService({
    ...shared,
    emailSender: deps.emailSender,
  });
  const { resetPassword } = createResetPasswordService({
    ...shared,
    emailSender: deps.emailSender,
    checkPwnedPassword: deps.checkPwnedPassword,
  });
  const { verifyCode } = createVerifyCodeService(shared);
  const { login } = createLoginService({
    ...shared,
    throttle: deps.credentialThrottle,
    repo: {
      findAuthUserByEmail: deps.repository.findAuthUserByEmail,
      createSession: deps.sessionRepository.createSession,
    },
  });
  const { authenticate } = createAuthenticateService({
    ...shared,
    repo: deps.sessionRepository,
  });
  const { changePassword } = createChangePasswordService({
    ...shared,
    emailSender: deps.emailSender,
    checkPwnedPassword: deps.checkPwnedPassword,
    throttle: deps.credentialThrottle,
  });

  return {
    signup,
    forgotPassword,
    resetPassword,
    resendCode,
    verifyCode,
    login,
    authenticate,
    changePassword,
    currentUser: (id: number) => deps.repository.findAuthUserById(id),
  };
}

export type Auth = ReturnType<typeof createAuth>;
