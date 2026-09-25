import type { OtpModule } from "../../modules/otp/index.js";

export type ResendSignupCodeResult =
  | { outcome: "sent"; sessionToken: string }
  | { outcome: "invalid-session" }
  | { outcome: "cooldown" }
  | { outcome: "limit-reached" }
  | { outcome: "email-unavailable" };

interface ResendSignupCodeDeps {
  otp: Pick<OtpModule, "resend">;
}

export function createResendSignupCode(deps: ResendSignupCodeDeps) {
  return async (
    sessionToken: string | undefined,
  ): Promise<ResendSignupCodeResult> => {
    if (!sessionToken) {
      return { outcome: "invalid-session" };
    }
    const outcome = await deps.otp.resend("signup", sessionToken);
    return outcome === "sent" ? { outcome, sessionToken } : { outcome };
  };
}
