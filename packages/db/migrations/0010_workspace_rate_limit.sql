-- The app role's rate-limit log (#403, §13 The app's API: "Rate limits live in a Postgres table … uploads, and
-- anything that starts AI work"): one row per allowed request in a workspace's bucket. sign-in's `rate_limit_hit`
-- (0005) is lzp_auth's alone and holds no workspace, so the app role can't count there; this table is a workspace's.
-- Expand only: one new table that no running code reads yet. No existing row is read, changed or removed. Taken back,
-- if ever needed, by dropping the table (in a later migration).
--
-- Written by hand from src/schema/rate-limits.ts, like 0008 (§13 A4): its row-level security is §13's policy, as in
-- 0000, and the one rule the Drizzle schema can't hold is the grant: lzp_app reads, adds and deletes hits, and changes
-- none; lzp_auth gets nothing. A bucket keeps at most its limit of rows (`hitWorkspaceRateLimit` deletes the ones past
-- the window before it counts), and a workspace's hits go with it.
--
-- Runs as the owner role, inside the migrator's transaction; SET LOCAL ends with it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_rate_limit_hit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_rate_limit_hit_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
-- A new, empty table, created in this same transaction: nothing waits on the lock CONCURRENTLY would avoid. It serves
-- the limiter's count and delete, and the workspace key's cascade.
CREATE INDEX IF NOT EXISTS "workspace_rate_limit_hit_workspace_id_bucket_created_at_idx" ON "workspace_rate_limit_hit" USING btree ("workspace_id","bucket","created_at");
--> statement-breakpoint
ALTER TABLE "workspace_rate_limit_hit" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_scope" ON "workspace_rate_limit_hit" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id')::uuid) WITH CHECK (workspace_id = current_setting('app.workspace_id')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "workspace_rate_limit_hit" TO lzp_app;
