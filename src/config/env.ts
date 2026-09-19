import { existsSync } from "node:fs";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
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
