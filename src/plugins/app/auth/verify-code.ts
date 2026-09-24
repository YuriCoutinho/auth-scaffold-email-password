import type { FastifyBaseLogger } from "fastify";
import { generatePublicId } from "../../../lib/public-id.js";
import {
  generateSessionToken,
  MAX_CODE_ATTEMPTS,
  SESSION_TTL_SECONDS,
} from "../../../lib/session.js";
import { hashOtpCode, hashSessionToken } from "../../../lib/token-hash.js";
import type { AuthRepository } from "./repository.js";

export type VerifyCodeResult =
  | { outcome: "verified"; sessionToken: string }
  | { outcome: "invalid" };

interface VerifyCodeServiceDeps {
  repo: Pick<
    AuthRepository,
    | "findPendingSignupBySessionToken"
    | "incrementCodeAttempts"
    | "promotePendingSignup"
  >;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createVerifyCodeService(deps: VerifyCodeServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async verifyCode(
      sessionToken: string | undefined,
      code: string,
      deviceLabel: string | null,
    ): Promise<VerifyCodeResult> {
      if (!sessionToken) {
        return { outcome: "invalid" };
      }

      const currentTime = now();
      const pending =
        await deps.repo.findPendingSignupBySessionToken(sessionToken);
      // The response stays the same 401 for both cases; only the log tells
      // them apart, so a dead signup session is not read as a wrong code.
      if (!pending) {
        deps.log?.info("signup session token not recognized");
        return { outcome: "invalid" };
      }
      if (pending.expiresAt <= currentTime) {
        deps.log?.info(
          { pendingSignupId: pending.id },
          "pending signup expired",
        );
        return { outcome: "invalid" };
      }

      // Exhausted codes stay unusable even if the right code shows up later;
      // /resend-code (attempts reset) or expiry are the only ways out.
      if (pending.codeAttempts >= MAX_CODE_ATTEMPTS) {
        return { outcome: "invalid" };
      }

      if (hashOtpCode(code) !== pending.codeHash) {
        await deps.repo.incrementCodeAttempts(sessionToken);
        const attempts = pending.codeAttempts + 1;
        deps.log?.warn(
          { pendingSignupId: pending.id, codeAttempts: attempts },
          attempts >= MAX_CODE_ATTEMPTS
            ? "signup code invalidated after too many failed attempts"
            : "signup code verification failed",
        );
        return { outcome: "invalid" };
      }

      const newSessionToken = generateSessionToken();
      const user = await deps.repo.promotePendingSignup({
        publicId: generatePublicId(),
        email: pending.email,
        passwordHash: pending.passwordHash,
        sessionPublicId: generatePublicId(),
        sessionTokenHash: hashSessionToken(newSessionToken),
        deviceLabel,
        sessionExpiresAt: new Date(
          currentTime.getTime() + SESSION_TTL_SECONDS * 1000,
        ),
      });
      deps.log?.info(
        { pendingSignupId: pending.id, userId: user.id },
        "pending signup promoted to auth user",
      );

      return { outcome: "verified", sessionToken: newSessionToken };
    },
  };
}

export type VerifyCodeService = ReturnType<typeof createVerifyCodeService>;
