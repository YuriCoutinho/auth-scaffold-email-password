import type { FastifyBaseLogger } from "fastify";
import { hashPassword, verifyPassword } from "../../../lib/password.js";
import type { EmailSender } from "../email/sender.js";
import type { CheckPwnedPassword } from "../pwned-password/checker.js";
import type { AuthRepository } from "./repository.js";
import { sendPasswordChanged } from "./send-password-changed.js";

export type ChangePasswordResult =
  | { outcome: "changed" }
  | { outcome: "invalid-current-password" }
  | { outcome: "same-password" }
  | { outcome: "pwned-password" };

export interface ChangePasswordInput {
  userId: number;
  currentSessionId: number;
  currentPassword: string;
  newPassword: string;
}

interface ChangePasswordServiceDeps {
  repo: Pick<
    AuthRepository,
    "findAuthUserCredentialsById" | "changeUserPassword"
  >;
  emailSender: EmailSender;
  checkPwnedPassword: CheckPwnedPassword;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createChangePasswordService(deps: ChangePasswordServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async changePassword(
      input: ChangePasswordInput,
    ): Promise<ChangePasswordResult> {
      const user = await deps.repo.findAuthUserCredentialsById(input.userId);

      // Proof of possession comes first: the breach lookup is an outbound
      // call, and nobody gets to spend it by guessing with a stolen cookie.
      if (
        !user ||
        !(await verifyPassword(user.passwordHash, input.currentPassword))
      ) {
        deps.log?.warn(
          { userId: input.userId, reason: "invalid_current_password" },
          "password change failed",
        );
        return { outcome: "invalid-current-password" };
      }

      if (input.newPassword === input.currentPassword) {
        return { outcome: "same-password" };
      }

      if (await deps.checkPwnedPassword(input.newPassword)) {
        return { outcome: "pwned-password" };
      }

      await deps.repo.changeUserPassword({
        userId: user.id,
        passwordHash: await hashPassword(input.newPassword),
        revokedAt: now(),
        revokedReason: "password_changed",
        exceptSessionId: input.currentSessionId,
      });
      deps.log?.info({ userId: user.id }, "password changed");

      // Awaited, like every other send in this project, but the result never
      // reaches the response: the password already changed, so failing the
      // request here would tell the user the opposite of what happened.
      await sendPasswordChanged(
        { emailSender: deps.emailSender, log: deps.log },
        { to: user.email, userId: user.id },
      );

      return { outcome: "changed" };
    },
  };
}

export type ChangePasswordService = ReturnType<
  typeof createChangePasswordService
>;
