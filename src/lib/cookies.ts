import type { CookieSerializeOptions } from "@fastify/cookie";
import { SESSION_TTL_SECONDS, SIGNUP_TTL_SECONDS } from "./session.js";

const hardened = {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
} satisfies CookieSerializeOptions;

export const SESSION_COOKIE = {
  name: "session",
  options: {
    ...hardened,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  } satisfies CookieSerializeOptions,
};

export const SIGNUP_SESSION_COOKIE = {
  name: "signup_session",
  options: {
    ...hardened,
    path: "/auth",
    maxAge: SIGNUP_TTL_SECONDS,
  } satisfies CookieSerializeOptions,
};
