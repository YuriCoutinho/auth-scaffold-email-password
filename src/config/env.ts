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
};

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
