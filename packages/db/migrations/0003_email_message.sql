-- The email outbox (#72, §13 Data model, Messages): one row per email, so a retried job never sends twice. Expand
-- only: a new table that no running code reads yet.
--
-- Written by hand from src/schema/email-message.ts, like 0000 (§13 A4): the key inline, and the app role's grants. Its
-- row-level security is §13's policy, as in 0000. The app role reads, writes and updates rows; it doesn't delete them
-- (a workspace's messages go with the workspace, by the cascade).
--
-- Runs as the owner role, inside the migrator's transaction; SET LOCAL ends with it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template" text NOT NULL,
	"to_address" text NOT NULL,
	"reply_to" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_id" text,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_message_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "email_message_status_check" CHECK (status in ('queued', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "email_message" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_scope" ON "email_message" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id')::uuid) WITH CHECK (workspace_id = current_setting('app.workspace_id')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "email_message" TO lzp_app;
