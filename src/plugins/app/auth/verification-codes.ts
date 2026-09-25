import type { FastifyBaseLogger } from "fastify";
import { MAX_CODE_ATTEMPTS } from "../../../lib/session.js";
import { hashOtpCode, hashVerificationToken } from "../../../lib/token-hash.js";
import { hasExpired } from "../../../lib/ttl.js";
import type {
  AuthRepository,
  VerificationCodeRecord,
  VerificationPurpose,
} from "./repository.js";

export type VerifyOutcome =
  | { outcome: "valid"; code: VerificationCodeRecord }
  | { outcome: "invalid" };

interface VerificationCodesDeps {
  repo: Pick<
    AuthRepository,
    "findVerificationCodeByTokenHash" | "incrementVerificationAttempts"
  >;
  hmacSecret: string;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

const LABELS = {
  signup: "signup code",
  password_reset: "password reset code",
} as const;

export function createVerificationCodes(deps: VerificationCodesDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    // Checks the code without consuming it: consumption belongs to the
    // transaction of the flow that acts on it.
    async verify(
      purpose: VerificationPurpose,
      token: string | undefined,
      code: string,
    ): Promise<VerifyOutcome> {
      if (!token) {
        return { outcome: "invalid" };
      }
      const label = LABELS[purpose];
      const record = await deps.repo.findVerificationCodeByTokenHash(
        purpose,
        hashVerificationToken(token),
      );
      // Every case answers the same 401; only the log tells them apart.
      if (!record) {
        deps.log?.info({ purpose }, `${label} token not recognized`);
        return { outcome: "invalid" };
      }
      if (hasExpired(record.expiresAt, now())) {
        deps.log?.info({ userId: record.userId, purpose }, `${label} expired`);
        return { outcome: "invalid" };
      }

      // Exhausted codes stay unusable even if the right code shows up later;
      // a new code or expiry are the only ways out.
      if (record.codeAttempts >= MAX_CODE_ATTEMPTS) {
        return { outcome: "invalid" };
      }

      if (hashOtpCode(deps.hmacSecret, code) !== record.codeHash) {
        await deps.repo.incrementVerificationAttempts({
          userId: record.userId,
          purpose,
        });
        const attempts = record.codeAttempts + 1;
        deps.log?.warn(
          { userId: record.userId, purpose, codeAttempts: attempts },
          attempts >= MAX_CODE_ATTEMPTS
            ? `${label} invalidated after too many failed attempts`
            : `${label} verification failed`,
        );
        return { outcome: "invalid" };
      }

      return { outcome: "valid", code: record };
    },
  };
}

export type VerificationCodes = ReturnType<typeof createVerificationCodes>;
