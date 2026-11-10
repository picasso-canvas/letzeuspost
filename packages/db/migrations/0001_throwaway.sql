ALTER TABLE "workspace" ADD COLUMN "plan" text NOT NULL;
ALTER TABLE "member" DROP COLUMN "role";
