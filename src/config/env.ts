import { existsSync } from "node:fs";
import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]);
const portSchema = z.coerce.number().int().positive();
const emailDriverSchema = z.enum(["fake", "mailpit", "resend"]);

export type Env = {
  DATABASE_URL: string;
  PORT: number;
  NODE_ENV: z.infer<typeof nodeEnvSchema>;
  EMAIL_DRIVER: z.infer<typeof emailDriverSchema>;
  EMAIL_FROM?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  FRONTEND_ORIGIN?: string | undefined;
};

// A positive rule: the value has to *be* an origin. Comparing against
// URL.origin drops any path, query or trailing slash, and the host check
// drops the wildcard forms that the URL parser happily accepts.
function originSchema(base: z.ZodString) {
  return base.refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === value &&
      !url.hostname.includes("*")
    );
  }, "must be an absolute http(s) origin, with no path, trailing slash or wildcard");
}

function envSchemaFor(raw: NodeJS.ProcessEnv) {
  return z.object({
    DATABASE_URL: z.url(),
    PORT:
      raw.NODE_ENV === "production"
        ? z
            .string("required when NODE_ENV is production")
            .transform(Number)
            .pipe(z.number().int().positive())
        : portSchema.default(3000),
    NODE_ENV: nodeEnvSchema,
    EMAIL_DRIVER: emailDriverSchema,
    EMAIL_FROM:
      raw.EMAIL_DRIVER === "fake"
        ? z.string().optional()
        : z.string("required unless EMAIL_DRIVER is fake").min(1),
    RESEND_API_KEY:
      raw.EMAIL_DRIVER === "resend"
        ? z.string("required when EMAIL_DRIVER is resend").min(1)
        : z.string().optional(),
    FRONTEND_ORIGIN:
      raw.NODE_ENV === "production"
        ? originSchema(z.string("required when NODE_ENV is production"))
        : originSchema(z.string()).optional(),
  });
}

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchemaFor(raw).safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}

export function loadEnv(): Env {
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }
  return parseEnv(process.env);
}
