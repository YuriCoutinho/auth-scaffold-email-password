export interface RateLimitPolicy {
  max: number;
  timeWindow: string;
}

export type RateLimitScope =
  | "global"
  | "login"
  | "changePassword"
  | "signup"
  | "forgotPassword"
  | "resendCode"
  | "verifyCode"
  | "resetPassword";

export type RateLimitOverrides = Partial<
  Record<RateLimitScope, RateLimitPolicy>
>;

// Per minute where the attack is brute force, per hour where each call costs an
// outbound email. The code-checking routes stay looser because the per-code
// attempt cap in the otp module is the real control there.
export const RATE_LIMITS: Record<RateLimitScope, RateLimitPolicy> = {
  global: { max: 100, timeWindow: "1 minute" },
  login: { max: 10, timeWindow: "1 minute" },
  changePassword: { max: 10, timeWindow: "1 minute" },
  signup: { max: 20, timeWindow: "1 hour" },
  forgotPassword: { max: 10, timeWindow: "1 hour" },
  resendCode: { max: 10, timeWindow: "1 hour" },
  verifyCode: { max: 20, timeWindow: "1 hour" },
  resetPassword: { max: 20, timeWindow: "1 hour" },
};

export function rateLimitFor(
  scope: RateLimitScope,
  overrides?: RateLimitOverrides,
): RateLimitPolicy {
  return overrides?.[scope] ?? RATE_LIMITS[scope];
}
