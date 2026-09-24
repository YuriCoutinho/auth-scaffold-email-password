import type { FastifyBaseLogger } from "fastify";
import { generateOtpCode } from "../../../lib/otp.js";
import { hashPassword } from "../../../lib/password.js";
import {
  generateSignupSessionToken,
  SIGNUP_TTL_SECONDS,
} from "../../../lib/session.js";
import { hashOtpCode } from "../../../lib/token-hash.js";
import type { EmailSender } from "../email/sender.js";
import type { CheckPwnedPassword } from "../pwned-password/checker.js";
import type { AuthRepository } from "./repository.js";
import { sendSignupCode } from "./send-signup-code.js";

export type SignupResult =
  | { outcome: "accepted"; sessionToken: string }
  | { outcome: "pwned-password" };

interface SignupServiceDeps {
  repo: Pick<
    AuthRepository,
    | "findAuthUserByEmail"
    | "findPendingSignupByEmail"
    | "upsertPendingSignup"
    | "markPendingSignupUndelivered"
    | "rotatePendingSignupToken"
  >;
  emailSender: EmailSender;
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
        // Nothing is created or resent, but the token still rotates. A value
        // that stays the same across calls would answer, in two requests,
        // whether the address already has an account, which is the question
        // this response refuses to answer. The code already in the mailbox
        // keeps working because its validity lives in codeHash, not here.
        const rotated = generateSignupSessionToken();
        await deps.repo.rotatePendingSignupToken(email, rotated);
        return { outcome: "accepted", sessionToken: rotated };
      }

      const code = generateOtpCode();
      const sessionToken = generateSignupSessionToken();
      const { id: pendingSignupId } = await deps.repo.upsertPendingSignup({
        email,
        passwordHash: await hashPassword(password),
        codeHash: hashOtpCode(code),
        signupSessionToken: sessionToken,
        expiresAt: new Date(currentTime.getTime() + SIGNUP_TTL_SECONDS * 1000),
        now: currentTime,
      });

      // Detached, like /auth/forgot-password: the response is a fixed 202 that
      // delivery cannot change, and awaiting the provider would make a new
      // address slower than an already-confirmed one, which is account
      // enumeration by stopwatch. Failed delivery must not consume resend
      // quota, so the mark still runs, just after the response.
      void sendSignupCode(
        { emailSender: deps.emailSender, log: deps.log },
        { to: email, code, pendingSignupId },
      )
        .then((delivered) => {
          if (delivered) {
            return;
          }
          return deps.repo.markPendingSignupUndelivered(email);
        })
        .catch((markError) => {
          deps.log?.warn(
            { err: markError },
            "failed to mark pending signup as undelivered",
          );
        });

      return { outcome: "accepted", sessionToken };
    },
  };
}

export type SignupService = ReturnType<typeof createSignupService>;
