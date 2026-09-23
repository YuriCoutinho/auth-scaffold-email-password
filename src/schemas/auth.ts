import { z } from "zod";

export const messageSchema = z.object({ message: z.string() });

export const signupBodySchema = z.object({
  email: z.email().max(254),
  password: z.string().min(15).max(128),
});

export const verifyCodeBodySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export const loginBodySchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

export const loginResponseSchema = z.object({
  user: z.object({ publicId: z.uuid() }),
});

export const currentUserResponseSchema = z.object({
  user: z.object({ publicId: z.uuid(), email: z.email() }),
});
