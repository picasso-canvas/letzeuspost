-- Better Auth's tables out of the app role's reach (#176; Cerberus F1 and F2 on #173). lzp_app is the role every
-- `db.forWorkspace` and `forUser` transaction runs as, so until now any route or job could read every session token,
-- OAuth token and sign-in-link value, and change or delete any person. From here:
--   lzp_auth (no login, docker/postgres/roles.sh, #183) holds every grant lzp_app had on "user", "session", "account"
--     and "verification". lzp_app may switch to it but never inherits it (INHERIT FALSE), and only the auth handle in
--     @lzp/db/auth switches, on a pool of its own (src/no-role-switch.test.ts refuses a switch anywhere else);
--   lzp_app keeps SELECT on "user" alone, under row-level security: the person set (app.user_id) and the members of the
--     workspace set (app.workspace_id). It can't change anyone.
-- Better Auth's adapter never touches the workspace tables (#77, decision (a)), so lzp_auth gets none of them.
--
-- Written by hand like 0000 (§13 A4): the policies are drizzle-kit 0.31.11's output for src/schema.ts, word for word;
-- the grants and the invitation check are not in its reach. meta/0001_snapshot.json is its snapshot.
--
-- Runs as the owner role, inside the migrator's transaction; SET LOCAL ends with it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint

-- Revoking a table's privileges revokes its column privileges too, so lzp_app's UPDATE on "user"'s columns goes as well.
REVOKE ALL ON "user", "session", "account", "verification" FROM lzp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "session", "account", "verification" TO lzp_auth;
--> statement-breakpoint

-- "user" as 0000 had it for lzp_app: every column but the platform-admin flag, which only the owner role sets (§15;
-- 0000's trigger still refuses a new person with it set, whichever role inserts).
GRANT SELECT, INSERT, DELETE ON "user" TO lzp_auth;
--> statement-breakpoint
GRANT UPDATE ("name", "email", "email_verified", "image", "updated_at") ON "user" TO lzp_auth;
--> statement-breakpoint
GRANT SELECT ON "user" TO lzp_app;
--> statement-breakpoint

-- lzp_auth sees and writes every person: sign-in finds one by email or session before anyone is known. lzp_app sees only
-- whom its transaction acts for. With nothing set, the policy can't read the settings and Postgres refuses the query.
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "auth_handle" ON "user" AS PERMISSIVE FOR ALL TO "lzp_auth" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "member_scope" ON "user" AS PERMISSIVE FOR SELECT TO "lzp_app" USING (id = current_setting('app.user_id')::uuid or id in (select user_id from member where workspace_id = current_setting('app.workspace_id')::uuid));
--> statement-breakpoint

-- Cerberus F4 on #173: every invitation carries its role. The first step of making the column NOT NULL without a long
-- lock: a check that new rows meet, validated and replaced by NOT NULL in 0002. Its name isn't
-- "invitation_role_not_null", which Postgres 18 gives the NOT NULL constraint itself.
ALTER TABLE "invitation" DROP CONSTRAINT IF EXISTS "invitation_role_present";
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_role_present" CHECK ("role" IS NOT NULL) NOT VALID;
