-- The asset library's table (#400, §13 Data model, Files; §06; §10): one row per file in a brand's library.
-- Expand only: one new table that no running code reads yet. No existing row is read, changed or removed. Taken back,
-- if ever needed, by dropping the table (in a later migration: nothing else uses it yet).
--
-- Written by hand from src/schema/assets.ts, like 0007 (§13 A4): the keys inline, and the app role's grants. Its
-- row-level security is §13's policy, as in 0000. Rules the Drizzle schema can't hold, or holds only in part:
-- - The app role reads, adds and deletes assets, and changes only what processing, the tagging and the library change.
--   It can't move an asset to another workspace, brand, file, source or uploader (no grant on those columns).
-- - An asset's key names its brand and its workspace together, so a row of one workspace can't point at another's
--   brand (Postgres checks keys past row-level security). Deleting a brand deletes its files (§13 Deleting).
-- - The storage key is the asset's own original, `ws/<workspace>/brands/<brand>/assets/<id>/original` (§13 File
--   storage), so a row can only ever name a file in its own workspace and brand.
-- - The uploader is a member of the same workspace; when they leave, only "uploaded_by" is set to null
--   (`ON DELETE SET NULL (column)`), which keeps the row in its workspace: Drizzle's schema says `set null`.
--
-- Runs as the owner role, inside the migrator's transaction; SET LOCAL ends with it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text,
	"perceptual_hash" text,
	"size_bytes" bigint,
	"description" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"people_present" boolean,
	"consent" boolean DEFAULT false NOT NULL,
	"licence" text,
	"credit" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"focus_x" real,
	"focus_y" real,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_brand_fk" FOREIGN KEY ("brand_id","workspace_id") REFERENCES "public"."brand"("id","workspace_id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "asset_uploaded_by_fk" FOREIGN KEY ("workspace_id","uploaded_by") REFERENCES "public"."member"("workspace_id","user_id") ON DELETE SET NULL ("uploaded_by") ON UPDATE no action,
	CONSTRAINT "asset_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "asset_kind_check" CHECK (kind in ('logo', 'photo', 'product', 'people', 'document', 'example')),
	CONSTRAINT "asset_source_check" CHECK (source in ('own', 'client', 'cutout')),
	CONSTRAINT "asset_status_check" CHECK (status in ('ready', 'waiting', 'rejected')),
	CONSTRAINT "asset_storage_key_check" CHECK (storage_key = 'ws/' || workspace_id::text || '/brands/' || brand_id::text || '/assets/' || id::text || '/original'),
	CONSTRAINT "asset_sha256_check" CHECK (sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "asset_perceptual_hash_check" CHECK (perceptual_hash ~ '^[0-9a-f]{16,64}$'),
	CONSTRAINT "asset_size_bytes_check" CHECK (size_bytes >= 0),
	CONSTRAINT "asset_focus_check" CHECK ((focus_x is null) = (focus_y is null) and focus_x between 0 and 1 and focus_y between 0 and 1)
);
--> statement-breakpoint
-- A new, empty table, created in this same transaction: nothing waits on the lock CONCURRENTLY would avoid. The first
-- serves a brand's library and its key's cascade; the second, the uploader's key when a member leaves.
CREATE INDEX IF NOT EXISTS "asset_brand_id_workspace_id_idx" ON "asset" USING btree ("brand_id","workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_workspace_id_uploaded_by_idx" ON "asset" USING btree ("workspace_id","uploaded_by");
--> statement-breakpoint
ALTER TABLE "asset" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_scope" ON "asset" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id')::uuid) WITH CHECK (workspace_id = current_setting('app.workspace_id')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "asset" TO lzp_app;
--> statement-breakpoint
GRANT UPDATE ("kind", "sha256", "perceptual_hash", "size_bytes", "description", "tags", "people_present", "consent", "licence", "credit", "status", "focus_x", "focus_y", "updated_at") ON "asset" TO lzp_app;
