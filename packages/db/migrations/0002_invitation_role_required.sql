-- Every invitation carries its role (Cerberus F4 on #173, #176). 0001 added a check that new rows have one, NOT VALID;
-- here it is validated, and NOT NULL joins it: Postgres uses the validated check instead of scanning the table again.
-- The check stays beside NOT NULL (src/schema.ts declares both). The migrator applies every pending file in one
-- transaction, so on a deploy that runs 0001 and 0002 together the lock 0001 took is held until the end; the table is
-- empty, so that is a moment. Nothing writes invitations yet (they come with their own task, §23), and Better Auth
-- always gives one a role, so no row lacks it and no running code is refused.
--
-- Written by hand like 0000 (§13 A4); meta/0002_snapshot.json is drizzle-kit's snapshot of src/schema.ts.
--
-- Runs as the owner role, inside the migrator's transaction; SET LOCAL ends with it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
ALTER TABLE "invitation" VALIDATE CONSTRAINT "invitation_role_present";
--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "role" SET NOT NULL;
