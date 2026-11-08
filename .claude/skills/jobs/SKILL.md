---
name: jobs
description: How LetZeusPost runs slow work as pg-boss jobs in the worker (from §13): ids-only payloads, safe to run twice, bounded retries that end in Failed with a plain reason, and at most 4 posts at a time per workspace. Use when adding or changing a job, a queue, a scheduled job or anything that starts one, and when reviewing such a change.
---

# Jobs

The source of truth is [§13, Jobs](../../../docs/plan/13-architecture.md#jobs); where this file and another section
differ, §13 wins.

## What is a job

- **Anything slow is a job:** AI, renders, website reading, exports and emails run in `apps/worker`, and the web app
  never waits on them ([§13, Principles](../../../docs/plan/13-architecture.md#principles)). Even a quick AI rewrite in
  the editor is a job, because **only the worker holds the Anthropic key**
  ([§13, What runs](../../../docs/plan/13-architecture.md#what-runs)).
- pg-boss runs on the same Postgres. §13's queues: `ai` (each §09 task), `render`, `fetch` (worker → fetcher),
  `export`, `email`, and scheduled jobs (weekly lessons, client reminders, link and export expiry, deleting public
  images, daily usage counters).
- The worker never fetches a URL itself: it asks the fetcher through the `fetch` queue (§13). Its own outbound traffic
  goes only to the Anthropic API, the file store, Cloudflare Images (HEIC uploads), the email provider, Sentry and the
  fetcher, through the egress proxy (§13, §14).

## Payloads: ids only

- A payload holds **ids only, never content**: the workspace id and the ids of what the job works on. The handler
  loads everything else from the database.
- The handler sets the workspace first in each transaction with `set_config('app.workspace_id', …, true)` and reads
  and writes only through `db.forWorkspace(ctx)` (the `tenant-isolation` skill).
- No post text or email addresses in logs or error messages
  ([§13, Security summary](../../../docs/plan/13-architecture.md#security-summary)).

## Safe to run twice

A job can be retried, or killed halfway and run again. **A job killed halfway and retried produces no duplicate posts,
renders or emails** ([§13, Done when](../../../docs/plan/13-architecture.md#done-when)).

- **A step that already has its result for that version is skipped.**
- **Renders are keyed by content hash** (renderer and look versions, the brand's tokens and fonts, the slide content,
  the images and crops, size and format); the same key reuses the stored file
  ([§08, When renders happen](../../../docs/plan/08-render-engine.md#when-renders-happen-and-caching)).
- **Emails go through the `email_message` outbox** (template, to, status, provider id), so a retried job never sends
  twice ([§13, Data model](../../../docs/plan/13-architecture.md#data-model)).
- Store a step's result in one transaction, so a kill leaves the whole result or none, never half a result that a
  retry would skip.
- A retry never counts a post against the quota twice, and a post that ends `Failed` is given back
  ([§02, What counts as a post](../../../docs/plan/02-pricing-and-billing.md#what-counts-as-a-post)).

## Retries and failure

- Retries are **bounded, with backoff**. A job that keeps failing marks the post **`Failed` with a plain reason**
  ([§11, Post statuses](../../../docs/plan/11-review-and-approvals.md#post-statuses)), through the status machine in
  `packages/core`, which refuses moves §11 doesn't allow and writes an `audit_event` (§13).
- The bounds the plan sets: a structured-output schema failure is retried once
  ([§09, The tasks](../../../docs/plan/09-ai-pipeline.md#the-tasks)); temporary API errors are retried with backoff,
  and a refusal goes to the fallback model, then fails ([§09, How a batch runs](../../../docs/plan/09-ai-pipeline.md#how-a-batch-runs));
  `fitFix` gets at most 2 tries; a render crash retries once in a new browser, with limits of 20 s per slide and
  2 minutes per post ([§08, Chrome in Docker](../../../docs/plan/08-render-engine.md#chrome-in-docker)).
- For any other job the plan says only "bounded, with backoff". If neither the task nor its section gives the numbers,
  the plan doesn't say: write it under `needs-zeus`.

## Concurrency, caps and progress

- A batch fans out into one pipeline per post: write → images → render → fit fix → QC (§09). **At most 4 posts at a
  time per workspace**, through pg-boss's group concurrency with one group per workspace. Use that; don't build another
  limiter. It can briefly run a fifth under load, which is fine: AI cost caps are separate
  ([§22, Controls](../../../docs/plan/22-product-ai-guardrails.md#controls)).
- AI cost caps are enforced before the call, and usage is counted before the work it pays for (§22, §02; review
  checklist 11 and 13).
- Each render job gets a fresh browser context (§08).
- Screens that show progress ask the server every 2 seconds; there is no live push yet (§13).
- Monitoring watches the worker's heartbeat and the queues' depth and age, and alerts on a job older than 15 minutes
  or more than 5% failing ([§14, Monitoring and alerts](../../../docs/plan/14-infrastructure.md#monitoring-and-alerts)).

## Tests

- Unit tests use the mock AI provider; no real network.
- Integration tests against real Postgres ([§17, The layers](../../../docs/plan/17-testing.md#the-layers)): the job
  run twice leaves no duplicates, and the job killed halfway and retried leaves no duplicate posts, renders or emails.
- A tenancy test tries the job with workspace B's ids (the `tenant-isolation` skill).
- Integration and tenancy tests run in CI, or with `pnpm check:services` when dispatch has handed you the ports. **CI
  is what counts** ([§17, When things run](../../../docs/plan/17-testing.md#when-things-run)).

## What reviewers check

1. Slow work runs as a job in the worker; no request waits on AI, renders, fetching, exports or email; the Anthropic
   key is used only in the worker.
2. The payload holds ids only, the workspace's included; no post text or emails in logs or errors.
3. The handler sets the workspace with `set_config(…, true)` and uses the scoped helper; a tenancy test covers the job.
4. Each step skips when its result for that version exists; renders reuse their content hash; emails go through the
   outbox; a retry doesn't count usage again.
5. An integration test runs the job twice and kills it halfway, and finds no duplicates.
6. Retries are bounded with backoff, with the plan's numbers where it gives them; the last failure marks the post
   `Failed` with a plain reason, through the status machine.
7. Per-workspace concurrency comes from pg-boss groups; cost caps and quotas are checked before the work.
