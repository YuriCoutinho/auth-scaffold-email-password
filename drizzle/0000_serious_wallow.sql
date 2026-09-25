CREATE TABLE "credential_throttle" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"failed_count" integer NOT NULL,
	"last_failed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device_label" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"full_name" text,
	"role" text DEFAULT 'user' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('user', 'admin')),
	CONSTRAINT "users_email_normalized_check" CHECK ("users"."email" = lower(btrim("users"."email")))
);
--> statement-breakpoint
CREATE TABLE "verification_codes" (
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"code_send_count" integer DEFAULT 1 NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_codes_user_id_purpose_pk" PRIMARY KEY("user_id","purpose"),
	CONSTRAINT "verification_codes_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "verification_codes_purpose_check" CHECK ("verification_codes"."purpose" in ('signup', 'password_reset'))
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_throttle_last_failed_at_idx" ON "credential_throttle" USING btree ("last_failed_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "verification_codes_expires_at_idx" ON "verification_codes" USING btree ("expires_at");
--> statement-breakpoint
-- Hand-written: drizzle-kit does not generate triggers. Append this block again
-- whenever the baseline is regenerated.
CREATE FUNCTION "set_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "users_set_updated_at"
BEFORE UPDATE ON "users"
FOR EACH ROW
WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION "set_updated_at"();
