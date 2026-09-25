import { z } from "zod";
import {
  messageSchema,
  noContentSchema,
  passwordSchema,
} from "../../http/schemas.js";

export const resetPasswordBodySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  newPassword: passwordSchema,
});

export const resetPasswordSchema = {
  tags: ["auth"],
  summary: "Finish a password reset and sign in",
  description:
    "Verifies the 6-digit code for the reset identified by the " +
    "password_reset cookie, stores the new password, ends every " +
    "session of the account and starts a new one. Everything about the " +
    "code answers with the same generic 401, because telling the cases " +
    "apart would reveal which addresses have accounts.",
  body: resetPasswordBodySchema,
  response: {
    204: noContentSchema,
    400: messageSchema,
    401: messageSchema,
    429: messageSchema,
  },
};
