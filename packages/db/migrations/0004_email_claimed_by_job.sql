-- Which pg-boss job claimed an outbox row (#203, Argus F1 on #197). A run that claimed a row and then lost the database
-- left it `sending` for good: its job's retry took the claim for another run's. pg-boss retries a job under the same
-- id, so with the claiming job's id on the row, the retry knows the claim is its own dead run's and marks the row
-- interrupted (src/jobs/email-outbox.ts).
--
-- Expand only: a nullable column with no default, so adding it rewrites nothing, and the code before it (which never
-- names the column) runs unchanged on it. The app role's grants on the table cover the new column.
--
-- Written by hand like 0000 (§13 A4); the statement is drizzle-kit 0.31.11's for src/schema.ts, and
-- meta/0004_snapshot.json is its snapshot.
--
-- Runs as the owner role, inside the migrator's transaction; SET LOCAL ends with it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN IF NOT EXISTS "claimed_by_job" uuid;
