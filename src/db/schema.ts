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

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    // Names the kind of email so the retry policy and the give-up handler can
    // differ per type without the outbox knowing what any of them mean.
    type: text("type").notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    // Opaque to the outbox: the domain that enqueued the row uses it to decide
    // whether a give-up still concerns the state it wrote.
    correlationId: text("correlation_id"),
    // The instant the content stops being worth delivering, written by whoever
    // enqueues, because only the domain that minted a code knows when it dies.
    // Null for a message that carries nothing with a deadline.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    // Also the lease: claiming pushes it forward, so a worker that dies
    // mid-send leaves a row that becomes due again on its own.
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    index("email_outbox_due_idx").on(table.status, table.nextAttemptAt),
  ],
);
