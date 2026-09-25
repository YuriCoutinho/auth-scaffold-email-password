import { z } from "zod";

// How long each credential lives. The TTL is applied once, when the credential
// is issued, and the resulting expiry is stored with it: validity is decided
// at issue time, like the cookie Max-Age, so changing a TTL never reaches
// credentials already out.
export interface TtlPolicy {
  sessionSeconds: number;
  signupCodeSeconds: number;
  passwordResetCodeSeconds: number;
}

export const DEFAULT_TTL: TtlPolicy = {
  sessionSeconds: 30 * 24 * 60 * 60,
  signupCodeSeconds: 15 * 60,
  passwordResetCodeSeconds: 15 * 60,
};

const ttlSecondsSchema = z.number().int().positive();

const ttlOverridesSchema = z
  .object({
    sessionSeconds: ttlSecondsSchema,
    signupCodeSeconds: ttlSecondsSchema,
    passwordResetCodeSeconds: ttlSecondsSchema,
  })
  .partial();

export function resolveTtl(overrides?: Partial<TtlPolicy>): TtlPolicy {
  const parsed = ttlOverridesSchema.parse(overrides ?? {});
  return {
    sessionSeconds: parsed.sessionSeconds ?? DEFAULT_TTL.sessionSeconds,
    signupCodeSeconds:
      parsed.signupCodeSeconds ?? DEFAULT_TTL.signupCodeSeconds,
    passwordResetCodeSeconds:
      parsed.passwordResetCodeSeconds ?? DEFAULT_TTL.passwordResetCodeSeconds,
  };
}

export function expiresAt(issuedAt: Date, ttlSeconds: number): Date {
  return new Date(issuedAt.getTime() + ttlSeconds * 1000);
}

export function hasExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt <= now;
}

export function isExpired(
  issuedAt: Date,
  ttlSeconds: number,
  now: Date,
): boolean {
  return expiresAt(issuedAt, ttlSeconds) <= now;
}

// The oldest issue instant still valid at `now`, which is how a query filters
// live rows without the column holding an expiry.
export function issuedAfter(ttlSeconds: number, now: Date): Date {
  return new Date(now.getTime() - ttlSeconds * 1000);
}
