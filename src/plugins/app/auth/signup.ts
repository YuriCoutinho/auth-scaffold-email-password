import type { FastifyBaseLogger } from "fastify";
import { generateOtpCode } from "../../../lib/otp.js";
import { hashPassword } from "../../../lib/password.js";
import {
  generateSignupSessionToken,
  SIGNUP_TTL_SECONDS,
} from "../../../lib/session.js";
import { hashOtpCode } from "../../../lib/token-hash.js";
import type { CheckPwnedPassword } from "../pwned-password/checker.js";
import {
  renderSignupCodeEmail,
  SIGNUP_CODE_EMAIL_TYPE,
} from "./emails/signup-code.js";
import type { AuthRepository } from "./repository.js";

export type SignupResult =
  | { outcome: "accepted"; sessionToken: string }
  | { outcome: "pwned-password" };

interface SignupServiceDeps {
  repo: Pick<
    AuthRepository,
    | "findAuthUserByEmail"
    | "findPendingSignupByEmail"
    | "upsertPendingSignupAndQueueEmail"
  >;
  checkPwnedPassword: CheckPwnedPassword;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

export function createSignupService(deps: SignupServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async signup(rawEmail: string, password: string): Promise<SignupResult> {
      const email = rawEmail.trim().toLowerCase();

      if (await deps.checkPwnedPassword(password)) {
        return { outcome: "pwned-password" };
      }

      const currentTime = now();

      if (await deps.repo.findAuthUserByEmail(email)) {
        // Confirmed account: no code is generated or delivered, but the
        // response (cookie included) must be indistinguishable.
        return {
          outcome: "accepted",
          sessionToken: generateSignupSessionToken(),
        };
      }

      const pending = await deps.repo.findPendingSignupByEmail(email);
      if (pending && pending.expiresAt > currentTime) {
        return {
          outcome: "accepted",
          sessionToken: pending.signupSessionToken,
        };
      }

      const code = generateOtpCode();
      const sessionToken = generateSignupSessionToken();
      // The message is rendered here and queued with the row in one write, so
      // the request never waits on the provider and never has to compensate.
      const { id: pendingSignupId } =
        await deps.repo.upsertPendingSignupAndQueueEmail({
          email,
          passwordHash: await hashPassword(password),
          codeHash: hashOtpCode(code),
          signupSessionToken: sessionToken,
          expiresAt: new Date(
            currentTime.getTime() + SIGNUP_TTL_SECONDS * 1000,
          ),
          now: currentTime,
          message: {
            type: SIGNUP_CODE_EMAIL_TYPE,
            recipient: email,
            ...renderSignupCodeEmail({
              code,
              ttlMinutes: SIGNUP_TTL_SECONDS / 60,
            }),
          },
        });
      deps.log?.info({ pendingSignupId }, "signup code email queued");

      return { outcome: "accepted", sessionToken };
    },
  };
}

export type SignupService = ReturnType<typeof createSignupService>;
