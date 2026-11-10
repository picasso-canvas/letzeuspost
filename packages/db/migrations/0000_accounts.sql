-- The accounts tables (#71, §13 Data model), shaped for Better Auth 1.7 with workspace = organization.
--
-- Written by hand from src/schema.ts (§13 A4). drizzle-kit 0.31.11 does write row-level security into its migrations
-- (ENABLE ROW LEVEL SECURITY and each CREATE POLICY; the policies below are its output, word for word), but the rest
-- of its file adds every foreign key with a later ALTER TABLE and creates tables without IF NOT EXISTS, which squawk
-- refuses, and it has no grants. So: keys inline, the app role's grants and the one-Owner rule written here.
-- meta/ keeps drizzle-kit's snapshot of the schema, so the next `pnpm --filter @lzp/db db:generate` starts from it.
--
-- Runs as the owner role (lzp_owner, docker/postgres/roles.sh), inside the migrator's transaction.
SET lock_timeout = '5s';
--> statement-breakpoint
SET statement_timeout = '60s';
--> statement-breakpoint

-- Global (§13): Better Auth's people. No workspace data.
CREATE TABLE IF NOT EXISTS "user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workspace" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"plan" text,
	"default_timezone" text,
	"review_page_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint

-- §15: a workspace has exactly one Owner. The exclusion constraint refuses a second Owner row in a workspace, whether
-- it's inserted or promoted; handing ownership over demotes the old Owner first, in the same transaction.
CREATE TABLE IF NOT EXISTS "member" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "member_workspace_id_user_id_unique" UNIQUE("workspace_id","user_id"),
	CONSTRAINT "member_role_check" CHECK (role in ('owner', 'admin', 'editor', 'viewer')),
	CONSTRAINT "member_one_owner" EXCLUDE USING btree ("workspace_id" WITH =) WHERE (role = 'owner')
);
--> statement-breakpoint

-- Better Auth's organization feature reads and deletes invitations with a workspace: the table exists, empty, until
-- invitations come with their own task (§23).
CREATE TABLE IF NOT EXISTS "invitation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" uuid NOT NULL,
	CONSTRAINT "invitation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "invitation_role_check" CHECK (role in ('admin', 'editor', 'viewer')),
	CONSTRAINT "invitation_status_check" CHECK (status in ('pending', 'accepted', 'rejected', 'canceled'))
);
--> statement-breakpoint

-- Global: Better Auth's sign-in records, each one person's, read before anyone is known (a session by its token, an
-- account by its provider, a sign-in link by its identifier).
CREATE TABLE IF NOT EXISTS "session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_workspace_id" uuid,
	CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "verification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Row-level security on every workspace table, with §13's policy for reads and writes, and Q5's read-only policy for a
-- signed-in person's own memberships and workspaces. The app role (lzp_app) has no BYPASSRLS and owns no table, so
-- every policy applies to it.
ALTER TABLE "workspace" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "member" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_scope" ON "workspace" AS PERMISSIVE FOR ALL TO public USING (id = current_setting('app.workspace_id')::uuid) WITH CHECK (id = current_setting('app.workspace_id')::uuid);
--> statement-breakpoint
CREATE POLICY "user_scope" ON "workspace" AS PERMISSIVE FOR SELECT TO public USING (id in (select workspace_id from member where user_id = current_setting('app.user_id')::uuid));
--> statement-breakpoint
CREATE POLICY "workspace_scope" ON "member" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id')::uuid) WITH CHECK (workspace_id = current_setting('app.workspace_id')::uuid);
--> statement-breakpoint
CREATE POLICY "user_scope" ON "member" AS PERMISSIVE FOR SELECT TO public USING (user_id = current_setting('app.user_id')::uuid);
--> statement-breakpoint
CREATE POLICY "workspace_scope" ON "invitation" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id')::uuid) WITH CHECK (workspace_id = current_setting('app.workspace_id')::uuid);
--> statement-breakpoint

-- The app role reads and writes rows; it can't change the schema or TRUNCATE, which would skip row-level security.
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", "workspace", "member", "invitation", "session", "account", "verification" TO lzp_app;
