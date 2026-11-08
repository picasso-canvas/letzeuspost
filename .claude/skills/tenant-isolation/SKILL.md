---
name: tenant-isolation
description: How LetZeusPost keeps each workspace's data away from every other workspace (from §13): the scoped helper, row-level security on every workspace table, workspace file keys and a tenancy test for every route, action and job. Use whenever code reads or writes workspace data or adds a table, route, server action or job, and when reviewing such a change.
---

# Keeping workspaces apart

The source of truth is [§13, Keeping workspaces apart](../../../docs/plan/13-architecture.md#keeping-workspaces-apart-enforced-twice);
where this file and §13 differ, §13 wins. Workspaces are apart from day one, **enforced twice**: in the app and in the
database ([§13, Principles](../../../docs/plan/13-architecture.md#principles)). Each wall must stop a leak on its own.
`packages/db/**` and `tests/tenancy/**` are risky paths: Cerberus reviews the PR before it merges into `staging` (§19).

## Wall 1: the scoped helper (in the app)

- Every database read and write goes through **`db.forWorkspace(ctx)`** in `packages/db`, which adds the workspace to
  every query. Importing the raw database client outside `packages/db` is a lint error (`lzp/no-raw-db-client`). Never
  disable it or import around it.
- Every server action and route handler starts with the same guard: **session, workspace, permission**
  ([§13, The app's API](../../../docs/plan/13-architecture.md#the-apps-api)). The workspace comes from the signed-in
  session. A workspace id in a URL, form or body counts only after the guard has checked the user is a member of it.
- Ids from the request (a brand, a post, an asset) are looked up through the helper, so another workspace's id finds
  nothing.
- `proxy.ts` only redirects. It is never the only check
  ([§13, Sign-in and sessions](../../../docs/plan/13-architecture.md#sign-in-and-sessions)).
- Only Zeus's admin panel (§15) reads across workspaces, through its own database role, and every such read is audited.

## Wall 2: row-level security (in Postgres)

- **Every table except the global ones carries `workspace_id`**, a child table too (`post_version`, `export_file`,
  `review_link_post`) ([§13, Data model](../../../docs/plan/13-architecture.md#data-model)). The global tables §13 names
  are `user`, `invite_code` and `holiday`. For any other table that seems not to need it (Better Auth's `session`,
  `account`, `verification`), the plan doesn't say: write it under `needs-zeus`.
- **Every workspace table has row-level security enabled**, with the policy
  `workspace_id = current_setting('app.workspace_id')::uuid`, in the migration that creates the table (the
  `safe-migrations` skill). Write the policy as §13 gives it. Never loosen or drop one.
- **The app connects as a role that can't bypass it.** In Postgres terms: not a superuser, no `BYPASSRLS`, and not the
  table's owner unless the table has `FORCE ROW LEVEL SECURITY`.
- **Every transaction sets the workspace first:** `set_config('app.workspace_id', …, true)`. The `true` makes it last
  only for that transaction, so it never leaks to the next request on the same connection. Never a session-wide `SET`.
- **Jobs carry the workspace id** in their payload and set it the same way (the `jobs` skill).
- Drizzle declares the policies. If drizzle-kit can't write them into migrations (checked in M0), those migrations are
  written in SQL by hand ([§13, A4](../../../docs/plan/13-architecture.md#what-happens-to-the-assumptions-a1a15)).

## Files, caches, AI and review links

- Every file key starts with `ws/<workspace id>/`, and the browser only gets short-lived signed links: 15 minutes,
  export downloads 7 days ([§13, File storage](../../../docs/plan/13-architecture.md#file-storage)). The public bucket
  holds only the finished JPEGs of exported posts, under random names. Nothing else is ever public.
- **No shared cache of workspace data:** `use cache` and cache components are banned by lint (`lzp/no-use-cache`) for
  anything that reads it, and those pages render per request ([§13, Stack](../../../docs/plan/13-architecture.md#stack)).
- Every AI call is scoped to one workspace and one brand. No other brand's data enters a prompt, and cache keys include
  the workspace ([§22, Controls](../../../docs/plan/22-product-ai-guardrails.md#controls), item 7).
- Each render job gets a fresh browser context, so nothing carries from one workspace to another
  ([§08, Chrome in Docker](../../../docs/plan/08-render-engine.md#chrome-in-docker)).
- A client reviewer has no account: the review link's cookie is valid only for that link, which reaches only that
  batch's sent posts ([§13, Security summary](../../../docs/plan/13-architecture.md#security-summary)).

## Tenancy tests

- `tests/tenancy/` signs in as workspace A and tries **every route, action and job with workspace B's ids**. Each
  attempt must fail. It runs on every PR and blocks the merge
  ([§17, The layers](../../../docs/plan/17-testing.md#the-layers)).
- The list of routes comes from the app itself, so **a new route without a tenancy test fails the suite**. Write the
  test in the same PR as the route, action or job.
- An attempt has failed only when nothing of B's comes back and nothing of B's changed. Check both, not just a status.
- Row-level security gets its own integration test against real Postgres, inside `packages/db`: a query that drops the
  workspace filter, run as the app's role, sees nothing of B's. §13's Done-when asks for that broken query to be caught
  twice, by the lint rule and by row-level security
  ([§13, Done when](../../../docs/plan/13-architecture.md#done-when)).
- These tests need Postgres, so they run in CI, or with `pnpm check:services` when dispatch has handed you the ports.
  **CI is what counts**; a run on the Mac is your own feedback, never evidence
  ([§17, When things run](../../../docs/plan/17-testing.md#when-things-run)).

## What reviewers check

1. No raw database client outside `packages/db`; no lint rule disabled or worked around.
2. Every new handler opens with the session, workspace, permission guard; no workspace id from the request is used
   without a membership check.
3. Every new table that holds workspace data has `workspace_id`, row-level security enabled and §13's policy unchanged,
   in the migration that creates it. No policy loosened or dropped.
4. The workspace is set with `set_config(…, true)` inside each transaction, in the web app and in jobs.
5. File keys start with `ws/<workspace id>/`; the browser gets only signed links; nothing new in the public bucket.
6. No `use cache` or cache components on workspace data; AI cache keys include the workspace.
7. A tenancy test for every new route, action and job, with B's ids, and the CI tenancy check green on the head commit.
8. Cross-workspace reads happen only in the admin panel, through its own role, and are audited.
