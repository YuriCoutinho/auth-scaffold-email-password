import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadEnv } from "../config/env.js";
import * as schema from "./schema.js";

const env = loadEnv();

export const sql = postgres(env.DATABASE_URL);
export const db = drizzle(sql, { schema });
