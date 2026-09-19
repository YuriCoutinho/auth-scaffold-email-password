import { existsSync } from "node:fs";
import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]);
const portSchema = z.coerce.number().int().positive();

export type Env = {
  DATABASE_URL: string;
  PORT: number;
  NODE_ENV: z.infer<typeof nodeEnvSchema>;
};

function envSchemaFor(nodeEnv: unknown) {
  return z.object({
    DATABASE_URL: z.url(),
    PORT:
      nodeEnv === "production"
        ? z
            .string("required when NODE_ENV is production")
            .transform(Number)
            .pipe(z.number().int().positive())
        : portSchema.default(3000),
    NODE_ENV: nodeEnvSchema,
  });
}

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchemaFor(raw.NODE_ENV).safeParse(raw);
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
