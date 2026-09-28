import { z } from "zod";
import { emailSchema, messageSchema } from "../../http/schemas.js";

export const forgotPasswordBodySchema = z.object({
  email: emailSchema,
});

export const forgotPasswordSchema = {
  tags: ["auth"],
  summary: "Start a password reset",
  description:
    "Emails a 6-digit reset code and sets the password_reset cookie. " +
    "Calling it again is the resend, subject to a cooldown and a send " +
    "cap. The response is intentionally generic and identical whether " +
    "or not the email belongs to an account, and the code is delivered " +
    "outside the request so the two cases cannot be told apart by how " +
    "long the response takes.",
  body: forgotPasswordBodySchema,
  response: {
    202: messageSchema,
    400: messageSchema,
    429: messageSchema,
  },
};
