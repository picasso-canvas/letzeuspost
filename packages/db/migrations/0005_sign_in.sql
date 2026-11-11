-- The tables email-link sign-in needs (#77): the account emails' outbox (Athena's decision 3, 2026-11-11) and the
-- rate-limit log (§13 The app's API). Expand only: two new tables that no running code reads yet.
--
-- Neither holds workspace data, so neither carries workspace_id or §13's policy. Like "verification", only lzp_auth
-- (the auth handle's role, docker/postgres/roles.sh) holds them; lzp_app gets nothing, so no route, job or
-- `db.forWorkspace` unit of work can read a sign-in link or a rate-limit bucket. Neither grants DELETE on
-- "account_email": a person's rows go with them, by the cascade.
--
-- Written by hand from src/schema/auth-only.ts, like 0003 (§13 A4): the keys inline, and the grants. meta/0005_snapshot.json
-- is drizzle-kit 0.31.11's snapshot for src/schema.ts.
--
-- Runs as the owner role, inside the migrator's transaction; SET LOCAL ends with it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_email" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"template" text NOT NULL,
	"to_address" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_id" text,
	"failure" text,
	"claimed_by_job" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "account_email_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "account_email_status_check" CHECK (status in ('queued', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "account_email" TO lzp_auth;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limit_hit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"bucket" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A new, empty table, created in this same transaction: nothing waits on the lock CONCURRENTLY would avoid.
CREATE INDEX IF NOT EXISTS "rate_limit_hit_bucket_created_at_idx" ON "rate_limit_hit" USING btree ("bucket","created_at");
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "rate_limit_hit" TO lzp_auth;
