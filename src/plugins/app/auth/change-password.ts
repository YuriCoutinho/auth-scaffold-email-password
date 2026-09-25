import type { FastifyBaseLogger } from "fastify";
import { hashPassword, verifyPassword } from "../../../lib/password.js";
import type { EmailSender } from "../../email/sender.js";
import type { CheckPwnedPassword } from "../../pwned-password/checker.js";
import type { CredentialThrottle } from "../credential-throttle/create-credential-throttle.js";
import type { AuthRepository } from "./repository.js";
import { sendPasswordChanged } from "./send-password-changed.js";

export type ChangePasswordResult =
  | { outcome: "changed" }
  | { outcome: "invalid-current-password" }
  | { outcome: "same-password" }
  | { outcome: "pwned-password" }
  | { outcome: "throttled"; retryAfterSeconds: number };

export interface ChangePasswordInput {
  userId: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
}

interface ChangePasswordServiceDeps {
  repo: Pick<AuthRepository, "findUserById" | "changePassword">;
  emailSender: EmailSender;
  checkPwnedPassword: CheckPwnedPassword;
  throttle: CredentialThrottle;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
}

export function createChangePasswordService(deps: ChangePasswordServiceDeps) {
  return {
    async changePassword(
      input: ChangePasswordInput,
    ): Promise<ChangePasswordResult> {
      const user = await deps.repo.findUserById(input.userId);
      if (!user) {
        deps.log?.warn(
          { userId: input.userId, reason: "invalid_current_password" },
          "password change failed",
        );
        return { outcome: "invalid-current-password" };
      }

      // Same key space as login, so alternating between the two endpoints does
      // not hand an attacker a second budget of free attempts.
      const throttleCheck = await deps.throttle.check(user.email);
      if (throttleCheck.outcome === "blocked") {
        return {
          outcome: "throttled",
          retryAfterSeconds: throttleCheck.retryAfterSeconds,
        };
      }

      // Proof of possession comes first: the breach lookup is an outbound
      // call, and nobody gets to spend it by guessing with a stolen cookie.
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
        await deps.throttle.registerFailure(user.email);
        deps.log?.warn(
          { userId: input.userId, reason: "invalid_current_password" },
          "password change failed",
        );
        return { outcome: "invalid-current-password" };
      }

      await deps.throttle.reset(user.email);

      if (input.newPassword === input.currentPassword) {
        return { outcome: "same-password" };
      }

      if (await deps.checkPwnedPassword(input.newPassword)) {
        return { outcome: "pwned-password" };
      }

      await deps.repo.changePassword({
        userId: user.id,
        passwordHash: await hashPassword(input.newPassword),
        exceptSessionId: input.currentSessionId,
      });
      deps.log?.info({ userId: user.id }, "password changed");

      // Detached: the password already changed, so delivery cannot decide the
      // response, and nothing is gained by making the caller wait for it.
      void sendPasswordChanged(
        { emailSender: deps.emailSender, log: deps.log },
        { to: user.email, userId: user.id },
      ).catch((sendError) => {
        deps.log?.warn(
          { err: sendError },
          "failed to send the password changed email",
        );
      });

      return { outcome: "changed" };
    },
  };
}

export type ChangePasswordService = ReturnType<
  typeof createChangePasswordService
>;
