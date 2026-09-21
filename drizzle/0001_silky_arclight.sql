ALTER TABLE "profiles" DROP CONSTRAINT "profiles_coren_unique";--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "role" SET DEFAULT 'user'::text;--> statement-breakpoint
UPDATE "profiles" SET "role" = 'user' WHERE "role" = 'nurse';--> statement-breakpoint
DROP TYPE "public"."profile_role";--> statement-breakpoint
CREATE TYPE "public"."profile_role" AS ENUM('user', 'admin');--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "role" SET DEFAULT 'user'::"public"."profile_role";--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "role" SET DATA TYPE "public"."profile_role" USING "role"::"public"."profile_role";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "coren";