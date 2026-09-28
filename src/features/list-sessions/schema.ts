import { z } from "zod";
import { messageSchema } from "../../http/schemas.js";

export const sessionListResponseSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.uuid(),
      deviceLabel: z.string().nullable(),
      createdAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
      isCurrent: z.boolean(),
    }),
  ),
});

export const listSessionsSchema = {
  tags: ["sessions"],
  summary: "List the active sessions of the signed-in user",
  description:
    "Returns every session of the signed-in user that has not " +
    "expired, newest first, so a connected devices screen " +
    "can show them and revoke one. The session behind this request is " +
    "marked with isCurrent, so the caller can avoid signing itself out " +
    "by accident. The session token and its hash are never part of the " +
    "response. The error response is intentionally generic and " +
    "identical whether the cookie is missing, unknown, signed out or " +
    "expired.",
  response: {
    200: sessionListResponseSchema,
    401: messageSchema,
  },
};
