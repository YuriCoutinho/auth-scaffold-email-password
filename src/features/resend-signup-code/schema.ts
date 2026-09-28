import { messageSchema } from "../../http/schemas.js";

export const resendSignupCodeSchema = {
  tags: ["auth"],
  summary: "Resend the signup confirmation code",
  description:
    "Issues a fresh confirmation code for the unconfirmed account identified " +
    "by the signup_session cookie. Guarded by a per-signup cooldown and " +
    "a total send cap.",
  response: {
    202: messageSchema,
    401: messageSchema,
    429: messageSchema,
    503: messageSchema,
  },
};
