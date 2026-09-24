import type { VerificationCodes } from "./verification-codes.js";

export type ResendCodeResult =
  | { outcome: "sent"; sessionToken: string }
  | { outcome: "invalid-session" }
  | { outcome: "cooldown" }
  | { outcome: "limit-reached" }
  | { outcome: "email-unavailable" };

interface ResendCodeServiceDeps {
  codes: Pick<VerificationCodes, "resend">;
}

export function createResendCodeService(deps: ResendCodeServiceDeps) {
  return {
    async resendCode(
      sessionToken: string | undefined,
    ): Promise<ResendCodeResult> {
      if (!sessionToken) {
        return { outcome: "invalid-session" };
      }
      const outcome = await deps.codes.resend("signup", sessionToken);
      return outcome === "sent" ? { outcome, sessionToken } : { outcome };
    },
  };
}

export type ResendCodeService = ReturnType<typeof createResendCodeService>;
