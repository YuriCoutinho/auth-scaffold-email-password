import type { SignupRepo } from "../db/signup-repo.js";
import { generateOtpCode, generateSignupSessionToken } from "../lib/otp.js";
import { hashPassword } from "../lib/password.js";
import type { CheckPwnedPassword } from "../lib/pwned-password.js";
import { hashOtpCode } from "../lib/token-hash.js";
import type { EmailSender } from "./email-sender.js";

export const SIGNUP_TTL_SECONDS = 15 * 60;

export type SignupResult =
  | { outcome: "accepted"; sessionToken: string }
  | { outcome: "pwned-password" };

interface SignupServiceDeps {
  repo: SignupRepo;
  emailSender: EmailSender;
  checkPwnedPassword: CheckPwnedPassword;
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
      await deps.repo.upsertPendingSignup({
        email,
        passwordHash: await hashPassword(password),
        codeHash: hashOtpCode(code),
        signupSessionToken: sessionToken,
        expiresAt: new Date(currentTime.getTime() + SIGNUP_TTL_SECONDS * 1000),
        now: currentTime,
      });
      await deps.emailSender({ to: email, code });

      return { outcome: "accepted", sessionToken };
    },
  };
}

export type SignupService = ReturnType<typeof createSignupService>;
