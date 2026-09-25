import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const USER_ROLES = ["user", "admin"] as const;
export const VERIFICATION_PURPOSES = ["signup", "password_reset"] as const;

// Built from the constants so the constraint and the TypeScript type cannot
// drift. Safe as raw SQL because the values are literals of this file.
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

// One row per person, confirmed or not. A null email_verified_at is what a
// pending signup is, so the unique email holds across both states and an
// address can never be pending and confirmed at the same time.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    fullName: text("full_name"),
    role: text("role", { enum: USER_ROLES }).notNull().default("user"),
    // Written by the application clock, like every instant the retention
    // cutoffs are compared against.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    // Owned by the database: DEFAULT on insert and the users_set_updated_at
    // trigger on update, so writes from outside the ORM keep it right too.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("users_created_at_idx").on(table.createdAt),
    check("users_role_check", sql`${table.role} in (${sqlList(USER_ROLES)})`),
    // The application normalizes; the database refuses anything that skipped it.
    check(
      "users_email_normalized_check",
      sql`${table.email} = lower(btrim(${table.email}))`,
    ),
  ],
);

// Validity is issued_at plus the TTL configured for the purpose, computed when
// read, so a TTL change reaches rows that already exist.
export const verificationCodes = pgTable(
  "verification_codes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: VERIFICATION_PURPOSES }).notNull(),
    codeHash: text("code_hash").notNull(),
    // Hashed like a session token: the plaintext only ever lives in the
    // cookie, so a read-only leak of this table cannot finish a reset.
    tokenHash: text("token_hash").notNull().unique(),
    codeAttempts: integer("code_attempts").notNull().default(0),
    codeSendCount: integer("code_send_count").notNull().default(1),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.purpose] }),
    index("verification_codes_issued_at_idx").on(table.issuedAt),
    check(
      "verification_codes_purpose_check",
      sql`${table.purpose} in (${sqlList(VERIFICATION_PURPOSES)})`,
    ),
  ],
);

// Holds live sessions only: signing out deletes the row, and the retention
// sweep deletes the ones that expired.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    deviceLabel: text("device_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    // Decided at issue time, like the cookie Max-Age, so a TTL change never
    // reaches sessions already out.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_created_at_idx").on(table.createdAt),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

// Keyed by a hash of the email rather than the email itself: the row exists to
// count abuse, and a table about abuse has no business holding an address.
export const credentialThrottle = pgTable(
  "credential_throttle",
  {
    keyHash: text("key_hash").primaryKey(),
    failedCount: integer("failed_count").notNull(),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("credential_throttle_last_failed_at_idx").on(table.lastFailedAt),
  ],
);
