import type { FastifyBaseLogger } from "fastify";
import type { EmailSender } from "../../plugins/email/sender.js";
import { sendPasswordChanged } from "./emails/password-changed.js";
import type { UsersRepository } from "./repository.js";

export interface UsersServiceDeps {
  repo: UsersRepository;
  emailSender: EmailSender;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
}

export function createUsersService(deps: UsersServiceDeps) {
  return {
    findByEmail: deps.repo.findByEmail,
    findById: deps.repo.findById,
    upsertUnverified: deps.repo.upsertUnverified,
    markVerified: deps.repo.markVerified,
    setPasswordHash: deps.repo.setPasswordHash,
    purgeAbandonedUnverified: deps.repo.purgeAbandonedUnverified,
    // Only the public half of the record: the password hash stops here.
    async publicProfile(id: string) {
      const user = await deps.repo.findById(id);
      return user && { id: user.id, email: user.email };
    },
    // Detached: the password already changed, so delivery cannot decide the
    // response, and nothing is gained by making the caller wait for it.
    notifyPasswordChanged(input: { to: string; userId: string }): void {
      void sendPasswordChanged(deps, input).catch((sendError) => {
        deps.log?.warn(
          { err: sendError },
          "failed to send the password changed email",
        );
      });
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
