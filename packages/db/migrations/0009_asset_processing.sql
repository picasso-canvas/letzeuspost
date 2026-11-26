-- What the `asset` job writes (#402, §06 Reading uploaded files and Asset library, §10 Processing every image): a
-- possible duplicate, the plain reason a file was rejected, and a PDF's text.
-- Expand only: three nullable columns with no default, which the running code never reads or writes, so the code
-- before this still works on it (safe-migrations). No row is read, changed or removed. Taken back, if ever needed, by
-- dropping the three columns (in a later migration: the backup a deploy takes first keeps what they held).
--
-- Written by hand from src/schema/assets.ts, like 0008 (§13 A4). Rules the Drizzle schema can't hold:
-- - "duplicate_of" names the earliest earlier asset of the same workspace and brand that looks the same (equal sha256,
--   or a perceptual hash within 8 bits). It has no key (Zeus, 2026-11-26, option (c) on #402): the job writes it only
--   through an update whose WHERE finds that asset in the same workspace and brand (packages/db's
--   jobs/asset-processing.ts), and a reader takes an id that no longer exists as no duplicate. Both assets are kept
--   (Zeus, 2026-11-25).
-- - "reject_reason" is a plain sentence for the person who sent the file, never its content or name.
-- - The app role may change the three (the job is the app role); the grants that keep an asset in its workspace,
--   brand, file, source and uploader (0008) are unchanged.
--
-- Runs as the owner role, inside the migrator's transaction; SET LOCAL ends with it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "duplicate_of" uuid, ADD COLUMN IF NOT EXISTS "reject_reason" text, ADD COLUMN IF NOT EXISTS "extracted_text" text;
--> statement-breakpoint
GRANT UPDATE ("duplicate_of", "reject_reason", "extracted_text") ON "asset" TO lzp_app;
