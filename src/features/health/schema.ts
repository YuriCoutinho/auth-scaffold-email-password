import { z } from "zod";

export const healthSchema = {
  response: { 200: z.object({ status: z.literal("ok") }) },
};
