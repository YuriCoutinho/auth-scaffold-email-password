import { z } from "zod";
import { messageSchema, noContentSchema } from "../../http/schemas.js";

export const verifySignupBodySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export const verifySignupSchema = {
  tags: ["auth"],
  summary: "Confirm the signup code and sign in",
  description:
    "Verifies the 6-digit code for the unconfirmed account identified " +
    "by the signup_session cookie, confirms the account and starts an " +
    "authenticated session. The session lives only in the cookie: the " +
    "signed-in user is read from GET /me. The error response is " +
    "intentionally generic.",
  body: verifySignupBodySchema,
  response: {
    204: noContentSchema,
    400: messageSchema,
    401: messageSchema,
    429: messageSchema,
  },
};
