import { z } from "zod";

export const messageSchema = z.object({ message: z.string() });

// A 204 carries no body. Declaring `type: "null"` on the generated JSON Schema
// is what makes @fastify/swagger publish the response with a description only,
// instead of advertising an application/json body that never arrives.
export const noContentSchema = z
  .void()
  .meta({ type: "null", description: "No content." });

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

export const currentUserResponseSchema = z.object({
  user: z.object({ publicId: z.uuid(), email: z.email() }),
});

// Two defaults for two different absences: `default` covers a body that arrived
// without the field, `prefault` covers no body at all, which is what
// `fetch(url, { method: "POST" })` sends when there is nothing to say. It has to
// be prefault and not default because in Zod 4 `default` takes the output type,
// so `{}` would not typecheck here, while `prefault` feeds `{}` in as input and
// lets the inner default fill it.
export const logoutAllBodySchema = z
  .object({ includeCurrentSession: z.boolean().default(false) })
  .prefault({});
