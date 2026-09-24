import type { CookieSerializeOptions } from "@fastify/cookie";
import type { TtlPolicy } from "./ttl.js";

const hardened = {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
} satisfies CookieSerializeOptions;

export interface CookieSpec {
  name: string;
  options: CookieSerializeOptions & { path: string };
}

export interface CookiePolicy {
  session: CookieSpec;
  signupSession: CookieSpec;
  passwordReset: CookieSpec;
}

// Each cookie lives exactly as long as the credential it carries, so the
// policy is derived from the configured TTLs instead of fixed at import time.
export function cookiePolicy(ttl: TtlPolicy): CookiePolicy {
  return {
    session: {
      name: "session",
      options: { ...hardened, path: "/", maxAge: ttl.sessionSeconds },
    },
    signupSession: {
      name: "signup_session",
      options: { ...hardened, path: "/auth", maxAge: ttl.signupCodeSeconds },
    },
    passwordReset: {
      name: "password_reset",
      options: {
        ...hardened,
        path: "/auth",
        maxAge: ttl.passwordResetCodeSeconds,
      },
    },
  };
}
