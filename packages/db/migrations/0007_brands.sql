-- The brands tables (#399, §13 Data model, Brands; §06): a brand, and its kit as immutable versions, one per Save.
-- Expand only: two new tables that no running code reads yet. No existing row is read, changed or removed. Taken back,
-- if ever needed, by dropping the trigger, its function and the two tables (in a later migration: nothing else uses
-- them yet).
--
-- Written by hand from src/schema/brands.ts, like 0003 (§13 A4): the keys inline, and the app role's grants. Each
-- table's row-level security is §13's policy, as in 0000. Rules the Drizzle schema can't hold:
-- - "brand_kit_version" is immutable (§13): the app role reads and adds versions, and holds no UPDATE or DELETE, so it
--   can't change or remove one. Deleting a brand still removes its versions: Postgres runs the key's cascade as the
--   table's owner.
-- - A version's key names its brand and its workspace together, so a row of one workspace can't point at another's
--   brand (Postgres checks keys past row-level security).
-- - "brand"."current_kit_version" moves only to the brand's newest saved version (the trigger), which is what
--   `brandKits(…).saveKit` does, in the same transaction as the version it writes; a new brand starts with none.
--
-- Runs as the owner role, inside the migrator's transaction; SET LOCAL ends with it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_bn" text,
	"timezone" text,
	"approval_mode" text,
	"current_kit_version" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "brand_id_workspace_id_unique" UNIQUE("id","workspace_id"),
	CONSTRAINT "brand_approval_mode_check" CHECK (approval_mode in ('none', 'agency', 'agency-then-client'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand_kit_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"kit" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_kit_version_brand_fk" FOREIGN KEY ("brand_id","workspace_id") REFERENCES "public"."brand"("id","workspace_id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "brand_kit_version_brand_id_version_unique" UNIQUE("brand_id","version"),
	CONSTRAINT "brand_kit_version_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
ALTER TABLE "brand" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "brand_kit_version" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_scope" ON "brand" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id')::uuid) WITH CHECK (workspace_id = current_setting('app.workspace_id')::uuid);
--> statement-breakpoint
CREATE POLICY "workspace_scope" ON "brand_kit_version" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id')::uuid) WITH CHECK (workspace_id = current_setting('app.workspace_id')::uuid);
--> statement-breakpoint
-- The app role adds, reads and deletes brands, and changes what a brand's editor and its kit's Save change; never its
-- id or its workspace.
GRANT SELECT, INSERT, DELETE ON "brand" TO lzp_app;
--> statement-breakpoint
GRANT UPDATE ("name_en", "name_bn", "timezone", "approval_mode", "current_kit_version", "updated_at") ON "brand" TO lzp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "brand_kit_version" TO lzp_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "brand_current_kit_version_guard"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog
	AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF NEW.current_kit_version IS NOT DISTINCT FROM OLD.current_kit_version THEN
			RETURN NEW;
		END IF;
	END IF;
	IF NEW.current_kit_version IS DISTINCT FROM
		(SELECT max(v.version) FROM public.brand_kit_version v WHERE v.brand_id = NEW.id) THEN
		RAISE EXCEPTION 'brand.current_kit_version moves only to the brand''s newest saved kit version'
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER "brand_current_kit_version_guard" BEFORE INSERT OR UPDATE OF "current_kit_version" ON "brand"
	FOR EACH ROW EXECUTE FUNCTION "brand_current_kit_version_guard"();
