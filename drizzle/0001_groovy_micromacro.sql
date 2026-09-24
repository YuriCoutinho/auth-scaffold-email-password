CREATE TABLE "credential_throttle" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credential_throttle_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key_hash" text NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"last_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone,
	CONSTRAINT "credential_throttle_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE INDEX "credential_throttle_last_failed_at_idx" ON "credential_throttle" USING btree ("last_failed_at");