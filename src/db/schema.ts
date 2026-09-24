import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const profileRole = pgEnum("profile_role", ["user", "admin"]);

export const pendingSignups = pgTable(
  "pending_signups",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    codeHash: text("code_hash").notNull(),
    codeAttempts: integer("code_attempts").notNull().default(0),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    codeSendCount: integer("code_send_count").notNull().default(1),
    signupSessionToken: text("signup_session_token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("pending_signups_expires_at_idx").on(table.expiresAt)],
);

export const authUsers = pgTable("auth_users", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const profiles = pgTable("profiles", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  role: profileRole("role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const sessions = pgTable(
  "sessions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    publicId: uuid("public_id").notNull().unique().defaultRandom(),
    userId: integer("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    deviceLabel: text("device_label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

// Keyed by user, not by email: unlike a pending signup, the account already
// exists, so the reset hangs off it and disappears with it.
export const passwordResets = pgTable(
  "password_resets",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("user_id")
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    codeAttempts: integer("code_attempts").notNull().default(0),
    resetSessionToken: text("reset_session_token").notNull().unique(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    codeSendCount: integer("code_send_count").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("password_resets_expires_at_idx").on(table.expiresAt)],
);

// Keyed by a hash of the email rather than the email itself: the row exists to
// count abuse, and a table about abuse has no business holding an address.
export const credentialThrottle = pgTable(
  "credential_throttle",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    keyHash: text("key_hash").notNull().unique(),
    failedCount: integer("failed_count").notNull().default(0),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  },
  (table) => [
    index("credential_throttle_last_failed_at_idx").on(table.lastFailedAt),
  ],
);
