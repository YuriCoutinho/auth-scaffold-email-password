import { z } from "zod";

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

export const sessionParamsSchema = z.object({ sessionId: z.uuid() });
