import type { FastifyBaseLogger } from "fastify";
import type { EmailSender } from "../email/sender.js";
import type { CheckPwnedPassword } from "../pwned-password/checker.js";
import { createAuthenticateService } from "./authenticate.js";
import { createListSessionsService } from "./list-sessions.js";
import { createLoginService } from "./login.js";
import { createLogoutService } from "./logout.js";
import { createLogoutAllService } from "./logout-all.js";
import type { AuthRepository } from "./repository.js";
import { createResendCodeService } from "./resend-code.js";
import { createSignupService } from "./signup.js";
import { createVerifyCodeService } from "./verify-code.js";

export interface AuthDeps {
  repository: AuthRepository;
  emailSender: EmailSender;
  checkPwnedPassword: CheckPwnedPassword;
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
  const { resendCode } = createResendCodeService({
    ...shared,
    emailSender: deps.emailSender,
  });
  const { verifyCode } = createVerifyCodeService(shared);
  const { login } = createLoginService(shared);
  const { authenticate } = createAuthenticateService(shared);
  const { logout } = createLogoutService(shared);
  const { logoutAll } = createLogoutAllService(shared);
  const { listSessions } = createListSessionsService(shared);

  return {
    signup,
    resendCode,
    verifyCode,
    login,
    logout,
    logoutAll,
    listSessions,
    authenticate,
    currentUser: (id: number) => deps.repository.findAuthUserById(id),
  };
}

export type Auth = ReturnType<typeof createAuth>;
