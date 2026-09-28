import { messageSchema, noContentSchema } from "../../http/schemas.js";

export const logoutAllSchema = {
  tags: ["sessions"],
  summary: "Sign out of every device",
  description:
    "Deletes every session of the signed-in user except the one " +
    "behind this request, which is always preserved so signing out " +
    "everywhere does not lock the caller out of the device asking for " +
    "it. Signing out of that one too is DELETE /sessions/current. " +
    "Requires a valid session, so the response is 401 whenever the " +
    "cookie is missing, unknown, signed out or expired.",
  response: {
    204: noContentSchema,
    401: messageSchema,
  },
};
