import type { CookieSerializeOptions } from "@fastify/cookie";
import {
  PASSWORD_RESET_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  SIGNUP_TTL_SECONDS,
} from "./session.js";

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

export const PASSWORD_RESET_COOKIE = {
  name: "password_reset",
  options: {
    ...hardened,
    path: "/auth",
    maxAge: PASSWORD_RESET_TTL_SECONDS,
  } satisfies CookieSerializeOptions,
};
