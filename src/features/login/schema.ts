import { z } from "zod";
import {
  emailSchema,
  messageSchema,
  noContentSchema,
} from "../../http/schemas.js";

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const loginSchema = {
  tags: ["auth"],
  summary: "Sign in with email and password",
  description:
    "Verifies the credentials of a confirmed account and starts a new " +
    "session for this device. The session lives only in the cookie: " +
    "the signed-in user is read from GET /me. The error response is " +
    "intentionally generic and identical whether the email is unknown " +
    "or the password is wrong. Repeated failures for the same email " +
    "are throttled, and the 429 carries Retry-After in seconds.",
  body: loginBodySchema,
  response: {
    204: noContentSchema,
    400: messageSchema,
    401: messageSchema,
    429: messageSchema,
  },
};
