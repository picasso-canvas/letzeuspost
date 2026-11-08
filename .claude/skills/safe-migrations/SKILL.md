---
name: safe-migrations
description: How LetZeusPost changes its database schema without breaking a running deploy (from §13, §14 and §17): expand-then-contract, squawk on every migration, row-level security in the same migration, and a reversible plan for anything destructive. Use for every change to packages/db's schema or migrations, and when reviewing one.
---

# Safe migrations

Sources: [§13](../../../docs/plan/13-architecture.md) (stack, data model, workspaces),
[§14, Deploys](../../../docs/plan/14-infrastructure.md#deploys), [§17](../../../docs/plan/17-testing.md) and
[§19, Skills](../../../docs/plan/19-build-team-and-workflow.md#skills); where they differ, §13 wins. The schema and
migrations live in `packages/db`: a sensitive path, so the PR is `sensitive`, and a risky one, so Cerberus reviews it
before it merges into `staging` (§19, §20).

## Why: how a deploy runs

A deploy runs, in order: a fresh pgBackRest backup, **the migrations**, the new containers, a check of `/api/health`,
and an **automatic rollback to the previous images** if that check fails within 2 minutes (§14). The rollback swaps the
images, not the schema. So every migration must work with the code it ships with **and with the code running before
it**: old code on the new schema is exactly what runs after a rollback. Staging deploys `main` the same way,
automatically (§14). Builders never deploy; Zeus starts production deploys, and big changes go out in the Sunday window.

## Expand, then contract (§14)

- **Expand** (one PR, safe with old code): add a table, add a column the old code can ignore (nullable, or with a
  default), add an index, add a policy.
- **Contract** (a later task): drop or rename a column or table, change a type, make a column required. Only once no
  running code uses the old shape.
- A rename or type change takes three steps: add the new shape and write to both; move the reads over and backfill;
  drop the old shape in a later task.
- The plan doesn't say how a builder knows the expand step has reached production. A contract task must say so; if it
  doesn't, write the question under `needs-zeus` before dropping anything.

## squawk

- squawk checks every migration ([§17, The layers](../../../docs/plan/17-testing.md#the-layers)). Fix what it finds.
  Never silence a rule or skip a file; if a rule blocks something the task needs, write it under `needs-zeus` and stop.
- squawk joins the checks with the first migration
  ([§20, Checks](../../../docs/plan/20-builder-guardrails.md#4-checks-pnpm-check-locally-the-ci-job-ci-runs-it-and-more)).
  If your task adds a migration and squawk isn't in `pnpm check` and CI yet, and the task doesn't say to add it, write
  that under `needs-zeus`. Never hand over an unchecked migration.

## Destructive changes

- Dropping a table or column, deleting or rewriting data, or narrowing a type is destructive. It needs **a reversible
  plan and a backup step** (review checklist 12). The deploy takes a fresh backup before it migrates (§14); write in
  `.lzp/pr.md` how the data would come back, from that backup or from the old shape you kept.
- `post_version` and `audit_event` are **append-only**, and `brand_kit_version` is **immutable**
  ([§13, Data model](../../../docs/plan/13-architecture.md#data-model)). A migration that would change or delete their
  rows is a question for `needs-zeus`.
- Never touch the `pgboss` schema. pg-boss keeps its own tables there (§13).

## New tables and columns

- A table that holds workspace data gets `workspace_id`, row-level security enabled and §13's policy
  `workspace_id = current_setting('app.workspace_id')::uuid` **in the migration that creates it** (the
  `tenant-isolation` skill). No migration loosens or drops a policy.
- Data shapes (§13): ids are UUIDv7 (Postgres 18's `uuidv7()`); times are `timestamptz` in UTC; money is integer
  micro-dollars; post content is JSONB, checked by the zod schema on every write.
- The schema is Drizzle and the migrations come from drizzle-kit
  ([§13, Stack](../../../docs/plan/13-architecture.md#stack)). If drizzle-kit can't write the row-level security
  policies (checked in M0), those migrations are SQL written by hand
  ([§13, A4](../../../docs/plan/13-architecture.md#what-happens-to-the-assumptions-a1a15)).
- **Never edit a merged migration.** Once it reaches `main` it may already have run on staging. Fix it with a new one.

## Tests

- Integration tests against real Postgres ([§17](../../../docs/plan/17-testing.md#the-layers)): the migrations run on an
  empty database, and each new workspace table's row-level security hides another workspace's rows from the app's role.
- They need Postgres, so they run in CI, or with `pnpm check:services` when dispatch has handed you the ports. **CI is
  what counts** ([§17, When things run](../../../docs/plan/17-testing.md#when-things-run)).

## What reviewers check

1. squawk is green on every migration; no rule silenced, no file skipped.
2. Each migration is expand-only, or a contract step the task says is safe. The previous images still work on the new
   schema: no new required column the old code doesn't write, no drop or rename of anything the old code reads.
3. Every destructive change has a reversible plan in the PR text; no rows of `post_version`, `audit_event` or
   `brand_kit_version` changed.
4. Every new workspace table has `workspace_id`, row-level security and §13's policy in the same migration; no policy
   loosened or dropped.
5. UUIDv7 ids, `timestamptz`, integer micro-dollars, JSONB post content checked by zod.
6. No merged migration edited; the `pgboss` schema untouched.
7. The integration tests are green in CI on the head commit.
