import { z } from "zod";
import {
  messageSchema,
  noContentSchema,
  passwordSchema,
} from "../http/schemas.js";

export { messageSchema, noContentSchema, passwordSchema };

export const resetPasswordBodySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  newPassword: passwordSchema,
});

export const changePasswordBodySchema = z.object({
  // The current password is only compared against a stored hash, so the
  // strength rule must not apply: it would lock out anyone whose password
  // predates the rule.
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
