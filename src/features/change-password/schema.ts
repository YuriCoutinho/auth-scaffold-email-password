import { z } from "zod";
import {
  messageSchema,
  noContentSchema,
  passwordSchema,
} from "../../http/schemas.js";

export const changePasswordBodySchema = z.object({
  // The current password is only compared against a stored hash, so the
  // strength rule must not apply: it would lock out anyone whose password
  // predates the rule.
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const changePasswordSchema = {
  tags: ["auth"],
  summary: "Change the password of the signed-in user",
  description:
    "Replaces the password after confirming the current one, and " +
    "ends every other session of the user so a stolen cookie stops " +
    "working. The session behind this request is preserved, so the " +
    "caller stays signed in on this device. Requires a valid session, " +
    "so the response is 401 whenever the cookie is missing, unknown, " +
    "signed out or expired. Repeated wrong current passwords are " +
    "throttled, and the 429 carries Retry-After in seconds.",
  body: changePasswordBodySchema,
  response: {
    204: noContentSchema,
    400: messageSchema,
    401: messageSchema,
    429: messageSchema,
  },
};
