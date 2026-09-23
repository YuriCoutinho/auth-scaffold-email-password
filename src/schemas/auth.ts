import { z } from "zod";

export const messageSchema = z.object({ message: z.string() });

// A 204 carries no body. Declaring `type: "null"` on the generated JSON Schema
// is what makes @fastify/swagger publish the response with a description only,
// instead of advertising an application/json body that never arrives.
export const noContentSchema = z
  .void()
  .meta({ type: "null", description: "No content." });

// 15 to 128 characters and no composition rule, per NIST guidance for auth
// without a second factor. Shared so signup and password change cannot drift.
export const passwordSchema = z.string().min(15).max(128);

export const signupBodySchema = z.object({
  email: z.email().max(254),
  password: passwordSchema,
});

export const verifyCodeBodySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export const loginBodySchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

export const changePasswordBodySchema = z.object({
  // The current password is only compared against a stored hash, so the
  // strength rule must not apply: it would lock out anyone whose password
  // predates the rule.
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const currentUserResponseSchema = z.object({
  user: z.object({ publicId: z.uuid(), email: z.email() }),
});
