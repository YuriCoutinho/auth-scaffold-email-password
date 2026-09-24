import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["user", "admin"]);

export const verificationPurpose = pgEnum("verification_purpose", [
  "signup",
  "password_reset",
]);

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
    role: userRole("role").notNull().default("user"),
    // Written by the application clock, like every instant the retention
    // cutoffs are compared against.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("users_created_at_idx").on(table.createdAt)],
);

// Validity is issued_at plus the TTL configured for the purpose, computed when
// read, so a TTL change reaches rows that already exist.
export const verificationCodes = pgTable(
  "verification_codes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: verificationPurpose("purpose").notNull(),
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
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_created_at_idx").on(table.createdAt),
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
