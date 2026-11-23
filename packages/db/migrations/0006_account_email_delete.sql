-- lzp_auth may delete account emails (#323, CI F1): the worker's prune deletes the sent and failed ones past their
-- retention window, on the auth handle (src/jobs/auth-prune.ts). 0005 granted no DELETE on "account_email"; this
-- grants that alone, to lzp_auth alone. lzp_app still gets nothing on the table. "rate_limit_hit" keeps 0005's grants:
-- its prune takes no row lock, so lzp_auth needs no UPDATE there.
--
-- Expand only: a grant, which the code before it never needs and runs unchanged beside. Taken back with
-- `REVOKE DELETE ON "account_email" FROM lzp_auth;` if ever needed: no data changes here.
--
-- Written by hand like 0005 (§13 A4): grants are outside drizzle-kit's diff, so meta/0006_snapshot.json is 0005's
-- schema unchanged.
--
-- Runs as the owner role, inside the migrator's transaction; SET LOCAL ends with it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
GRANT DELETE ON "account_email" TO lzp_auth;
