import { defineConfig } from "drizzle-kit";
import { loadEnv } from "./src/config/env.js";

const { DATABASE_URL } = loadEnv();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: DATABASE_URL,
  },
});
