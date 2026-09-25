import { z } from "zod";
import {
  emailSchema,
  messageSchema,
  passwordSchema,
} from "../../http/schemas.js";

export const signupBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const signupSchema = {
  tags: ["auth"],
  summary: "Start an email/password signup",
  description:
    "Creates an unconfirmed account, or gives an unconfirmed one the new " +
    "password, and emails a 6-digit confirmation code. " +
    "The response is intentionally generic and identical whether or not " +
    "the email is already registered, and the code is delivered outside " +
    "the request so the two cases cannot be told apart by how long the " +
    "response takes.",
  body: signupBodySchema,
  response: {
    202: messageSchema,
    400: messageSchema,
    429: messageSchema,
  },
};
