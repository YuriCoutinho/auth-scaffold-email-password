import { z } from "zod";
import { messageSchema } from "../../http/schemas.js";

export const currentUserResponseSchema = z.object({
  user: z.object({ id: z.uuid(), email: z.email() }),
});

export const meSchema = {
  tags: ["auth"],
  summary: "Read the signed-in user",
  description:
    "Resolves the session cookie and returns the public data of the " +
    "user behind it. This is how the frontend learns who is signed in " +
    "on boot. The error response is intentionally generic and identical " +
    "whether the cookie is missing, unknown, signed out or expired.",
  response: {
    200: currentUserResponseSchema,
    401: messageSchema,
  },
};
