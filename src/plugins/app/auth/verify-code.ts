import type { FastifyBaseLogger } from "fastify";
import { generateId } from "../../../lib/id.js";
import { generateToken } from "../../../lib/session.js";
import { hashSessionToken } from "../../../lib/token-hash.js";
import { expiresAt } from "../../../lib/ttl.js";
import type { AuthRepository } from "./repository.js";
import type { VerificationCodes } from "./verification-codes.js";

export type VerifyCodeResult =
  | { outcome: "verified"; sessionToken: string }
  | { outcome: "invalid" };

interface VerifyCodeServiceDeps {
  repo: Pick<AuthRepository, "verifyEmail">;
  codes: Pick<VerificationCodes, "verify">;
  sessionTtlSeconds: number;
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
      const result = await deps.codes.verify("signup", sessionToken, code);
      if (result.outcome === "invalid") {
        return result;
      }

      const currentTime = now();
      const newSessionToken = generateToken();
      const verified = await deps.repo.verifyEmail({
        userId: result.code.userId,
        tokenHash: result.code.tokenHash,
        codeHash: result.code.codeHash,
        verifiedAt: currentTime,
        session: {
          id: generateId(),
          tokenHash: hashSessionToken(newSessionToken),
          deviceLabel,
          createdAt: currentTime,
          expiresAt: expiresAt(currentTime, deps.sessionTtlSeconds),
        },
      });
      if (!verified) {
        deps.log?.info(
          { userId: result.code.userId },
          "signup code already consumed by a concurrent request",
        );
        return { outcome: "invalid" };
      }
      deps.log?.info({ userId: result.code.userId }, "email verified");

      return { outcome: "verified", sessionToken: newSessionToken };
    },
  };
}

export type VerifyCodeService = ReturnType<typeof createVerifyCodeService>;
