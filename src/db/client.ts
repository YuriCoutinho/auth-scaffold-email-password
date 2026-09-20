import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadEnv } from "../config/env.js";
import * as schema from "./schema.js";

const { DATABASE_URL } = loadEnv();

export const sql = postgres(DATABASE_URL);
export const db = drizzle(sql, { schema });

export type Database = typeof db;
