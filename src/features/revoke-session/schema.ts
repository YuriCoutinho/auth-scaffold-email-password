import { z } from "zod";
import { messageSchema, noContentSchema } from "../../http/schemas.js";

export const sessionParamsSchema = z.object({ sessionId: z.uuid() });

export const revokeSessionSchema = {
  tags: ["sessions"],
  summary: "Revoke one session of the signed-in user",
  description:
    "Deletes the session named in the path, which is the id the " +
    "session listing returns. Only a session of the signed-in user is " +
    "ever deleted. The response is 204 whether the session was " +
    "deleted, never existed, belongs to someone else, was already " +
    "signed out or had expired, so the endpoint never reports whose " +
    "sessions exist. Signing this device out is DELETE " +
    "/sessions/current, and the session listing marks which row that " +
    "is with isCurrent.",
  params: sessionParamsSchema,
  response: {
    204: noContentSchema,
    400: messageSchema,
    401: messageSchema,
  },
};
