import type { FastifyBaseLogger } from "fastify";
import type { TtlPolicy } from "../../../lib/ttl.js";
import type { EmailSender } from "../../email/sender.js";
import type { CheckPwnedPassword } from "../../pwned-password/checker.js";
import type { CredentialThrottle } from "../credential-throttle/create-credential-throttle.js";
import type { SessionRepository } from "../sessions/repository.js";
import { createAuthenticateService } from "./authenticate.js";
import { createChangePasswordService } from "./change-password.js";
import { createForgotPasswordService } from "./forgot-password.js";
import { createLoginService } from "./login.js";
import type { AuthRepository } from "./repository.js";
import { createResendCodeService } from "./resend-code.js";
import { createResetPasswordService } from "./reset-password.js";
import { createSignupService } from "./signup.js";
import { createVerificationCodes } from "./verification-codes.js";
import { createVerifyCodeService } from "./verify-code.js";

export interface AuthDeps {
  repository: AuthRepository;
  sessionRepository: SessionRepository;
  emailSender: EmailSender;
  checkPwnedPassword: CheckPwnedPassword;
  credentialThrottle: CredentialThrottle;
  ttl: TtlPolicy;
  hmacSecret: string;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createAuth(deps: AuthDeps) {
  const shared = {
    repo: deps.repository,
    ...(deps.log ? { log: deps.log } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  };
  const codes = createVerificationCodes({
    ...shared,
    emailSender: deps.emailSender,
    ttl: deps.ttl,
    hmacSecret: deps.hmacSecret,
  });
  const { signup } = createSignupService({
    ...shared,
    codes,
    checkPwnedPassword: deps.checkPwnedPassword,
  });
  const { forgotPassword } = createForgotPasswordService({ ...shared, codes });
  const { resendCode } = createResendCodeService({ codes });
  const { resetPassword } = createResetPasswordService({
    ...shared,
    codes,
    emailSender: deps.emailSender,
    checkPwnedPassword: deps.checkPwnedPassword,
    throttle: deps.credentialThrottle,
    sessionTtlSeconds: deps.ttl.sessionSeconds,
  });
  const { verifyCode } = createVerifyCodeService({
    ...shared,
    codes,
    sessionTtlSeconds: deps.ttl.sessionSeconds,
  });
  const { login } = createLoginService({
    ...shared,
    throttle: deps.credentialThrottle,
    sessionTtlSeconds: deps.ttl.sessionSeconds,
    repo: {
      findUserByEmail: deps.repository.findUserByEmail,
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
    // Only the public half of the record: the password hash stops here.
    async currentUser(id: string) {
      const user = await deps.repository.findUserById(id);
      return user && { id: user.id, email: user.email };
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
