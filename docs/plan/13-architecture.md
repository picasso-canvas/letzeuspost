# Section 13: Technical architecture (Approved 2026-11-06)

**Goal:** the stack, the processes that run, the repo layout, the data model, how workspaces are kept apart, auth,
the job queue, file storage, the API and security, so the builders have one settled answer for each. Where it runs
(servers, backups, monitoring, monthly cost) is §14.

## Decided earlier

| Topic | Decision | Where |
|---|---|---|
| Rendering | Playwright + pinned Chromium in Docker; React layouts rendered to static HTML; the render browser has no internet; website reading uses a separate browser | §08 |
| AI | Anthropic SDK, structured outputs checked by zod, `config/models.ts` and `config/providers.ts`, a mock provider for builders, at most 4 posts at a time per workspace | §09 |
| Sign-in | Google or an emailed sign-in link; invites tied to an email, 7 days | §23 |
| Review links | Tokens of at least 128 bits, stored hashed, 30 days, revocable, rate-limited, noindex | §11 |
| Files | Images processed on upload (sRGB, EXIF removed, re-encoded); exports kept 30 days; Metricool image links public until 7 days after the last post date | §10, §12 |
| Isolation | Every AI call scoped to one workspace and brand; cache keys include the workspace | §22 |
| Building | Sensitive areas need Zeus's merge; "exact folders come from §13" | §20 |

## Spec

### Principles

1. **Few moving parts.** One language (TypeScript), one database (Postgres) that also runs the job queue, one file
   store. A solo owner and AI builders must be able to see everything that runs.
2. **Workspaces apart from day one,** enforced twice: in the app and in the database.
3. **Anything slow is a job.** AI, renders, website reading, exports and emails run in the worker; the web app never waits on them.
4. **Portable.** Plain Postgres and the S3 file API, so §14 can pick or change hosts without code changes.

### Stack

Versions checked 2026-11-06 on official pages (release notes, npm, GitHub). Exact versions are pinned in the
lockfile; these are the lines to start on.

| Area | Choice | Version | Licence | Notes |
|---|---|---|---|---|
| Runtime | **Node.js 26** | Active LTS since 2026-10-28, supported to 2029-04 | MIT | Node 24 is already in maintenance |
| Web app | **Next.js** (App Router), `output: "standalone"` | 16.4 (Active LTS) | MIT | Turbopack builds by default; `proxy.ts` replaces middleware; frequent security releases (below) |
| UI | **React** | 19.3 | MIT | Rendered on the server; also renders the post layouts (§08) |
| Styling | **Tailwind CSS** + **shadcn/ui** + Lucide icons + Inter | Tailwind 4.3, shadcn CLI 4 | MIT, ISC, OFL | shadcn's components now use Base UI by default (since July 2026); we follow the default. The look is confirmed by the §05 mockups |
| Validation | **zod** | current | MIT | One schema per thing, shared by the web app, the worker and the AI tasks |
| Database | **PostgreSQL 18** | 18.x | PostgreSQL | Built-in `uuidv7()`; row-level security |
| Database access | **Drizzle ORM** + drizzle-kit | 0.45 / 0.31 (1.0 is still a release candidate; move when it's stable) | Apache-2.0 | Declares row-level security policies; migrations checked by squawk (§19) |
| Sign-in | **Better Auth** (organization, magic link, Google) | 1.7 | MIT | Auth.js is now looked after by Better Auth, which joined Vercel in July 2026 |
| Jobs | **pg-boss** | 12 | MIT | Runs on Postgres; built-in **per-group concurrency** gives the 4-posts-per-workspace limit |
| AI | **Anthropic SDK** (`@anthropic-ai/sdk`) | current | MIT | §09 |
| Rendering | **Playwright** + its Chromium, image `mcr.microsoft.com/playwright:v1.65.0-noble` | 1.65 | Apache-2.0 | §08; `page.pdf()` has `tagged` and `outline` |
| Images | **sharp** | 0.35.5 or later (an image-optimisation security fix) | Apache-2.0; its libvips is LGPL | HEIC decision below |
| Email | **Resend** + React Email | current | MIT (SDKs) | Mailpit catches emails in development |
| Errors | **Sentry** | current SDK | MIT (SDK) | Personal data scrubbed |
| File store | **Cloudflare R2** through the S3 API | – | – | No egress fees, which matters for export and Metricool links |
| Web server | **Caddy** | 2.11 | Apache-2.0 | Automatic HTTPS; response buffering off so streamed pages work |
| Tests | Vitest, Playwright, Storybook | current | MIT, Apache-2.0 | Scope in §17 |
| Packages | **pnpm** workspace | current | MIT | |

**Framework security:** Next.js and React had several critical remote-code bugs in 2025–26 (React2Shell in December 2025,
more in September and October 2026) and a **cross-workspace data leak in Next.js's `use cache`** fixed on 2026-11-03.
So: critical security releases are applied **within 2 days** and others within a week (a `sensitive` PR Zeus
merges); and **workspace data is never put in Next.js's shared caches**: `use cache` and cache components are banned
by lint for anything that reads workspace data, and those pages render per request.

### What runs

```
            browser (agency app, client review page)
                │ HTTPS
             [Caddy] ── TLS, compression
                │
             [web]  Next.js: pages, server actions, review page, uploads (signed URLs), health
                │                                   │
         [Postgres] ◄── jobs (pg-boss) ──► [worker]  AI tasks · renders (offline Chromium) · exports · emails · schedules
                │                                   │  internal HTTP only
          [file store: R2]                     [fetcher]  reads websites and J3 links (online Chromium, safe-fetch)
```

| Process | Does | Can reach | Holds secrets |
|---|---|---|---|
| **web** | The app UI, server actions, the client review page, signed upload and download links | Postgres, the file store, the email provider | database, file store (signing), auth, email |
| **worker** | Every job: AI tasks, renders, exports, emails, scheduled work | Postgres, the file store, the Anthropic API, the email provider, the fetcher | database, file store, **the Anthropic key (only here)**, email |
| **fetcher** | Reads a URL in its own browser and returns text, styles and screenshots | **the internet only**: no database, no file store, no secrets | none |

- **Only the worker holds the Anthropic key.** Even a quick AI rewrite in the editor is a job.
- **The fetcher is a dead end:** the worker calls it over the internal network with a URL and gets back data. A
  malicious page that broke out of its browser would find no database, no files and no keys. It applies `safe-fetch`
  (public addresses only, redirects re-checked, size and time limits, §06).
- The render browser runs inside the worker with every request intercepted (§08); the worker's own outbound traffic
  is limited to the Anthropic API, the file store, the email provider and Sentry (enforced in §14).

### Repo layout (pnpm workspace)

```
apps/web            Next.js app: agency UI, client review page (/r/[token]), server actions, route handlers
apps/worker         job handlers: ai, render, export, email, schedules
apps/fetcher        website and link reading (online browser, safe-fetch), a small internal HTTP service
packages/core       domain rules: post statuses and transitions, the small-fix rule, permissions, quotas, post schema (zod)
packages/db         Drizzle schema, migrations, row-level security policies, the scoped query helper
packages/auth       Better Auth setup, sessions, invites, review-link sessions
packages/ai         provider interface, Anthropic and mock providers, prompts/, policy/, evals/
packages/render     buildSlide, layouts, looks, fit script, fonts manifest, text validator (§08)
packages/ui         tokens generated from DESIGN.md, shadcn components, the component gallery
packages/email      email templates (React Email) with plain-text versions
packages/storage    file store client, key scheme, signed links, image processing (§10)
config/             models.ts, providers.ts, plans.ts, networks.ts, env.ts
docker/             Dockerfiles, compose files, Caddyfile
tests/              e2e/, visual/, golden/ (renders), tenancy/ (cross-workspace tests)
docs/               plan/, design/
```

**Sensitive paths** (`.github/sensitive-paths.txt`, §20; changing this list is itself sensitive):

```
packages/auth/**            packages/core/src/permissions/**    packages/core/src/quotas/**
packages/db/**              packages/ai/prompts/**              packages/ai/policy/**
config/models.ts            config/providers.ts                 config/plans.ts             config/env.ts
package.json  **/package.json  pnpm-lock.yaml  pnpm-workspace.yaml  docker/**  .github/**  .claude/**
**/CLAUDE.md  DESIGN.md  docs/plan/**  tsconfig*.json  eslint.config.*  vitest.config.*  playwright.config.*
tests/visual/approved/**    tests/golden/**                     packages/render/src/looks/**
apps/fetcher/**             packages/storage/src/public-links/**  apps/web/src/app/r/**
```

The last line adds three areas §20 didn't name: the fetcher (the SSRF boundary), public image links (§12) and the
client review page (no-account access).

### Data model

Every table except the global ones carries `workspace_id`. IDs are UUIDv7 (time-ordered). Times are `timestamptz` in
UTC; a brand stores its IANA timezone (`Asia/Dhaka`) and the app shows times in it. Money is stored in **micro-dollars**
as integers. Post content is JSONB, checked by the zod schema on every write.

| Group | Tables (key columns) |
|---|---|
| **Accounts** | `user` (global: name, email, avatar, platform-admin flag for Zeus) · `workspace` (name, logo, plan, default timezone, review-page name) · `member` (workspace, user, role: owner / admin / editor / viewer) · `invitation` (email, role, inviter, expires, used) · `invite_code` (global, Zeus's agency sign-up codes) · Better Auth's `session`, `account`, `verification` |
| **Brands** | `brand` (name EN/BN, timezone, approval mode, current kit version) · `brand_kit_version` (**immutable** JSON snapshot of the kit with each item's source; posts point to the version they used, §06) · `brand_reviewer` (client name, email) · `brand_lesson` (§09 lessons, editable) · `holiday` (global curated lists + public holidays, by country) · `brand_holiday` (on/off, custom dates) |
| **Files** | `asset` (brand, kind, storage key, sha256, perceptual hash, size, description, tags, people present, consent, licence, credit, source: own / client / cutout; status: ready / waiting / rejected; parent for cutouts; focus point; uploaded by member or review link) · `font` (workspace-uploaded fonts with the licence tick, §08) |
| **Content** | `batch` (brand, job J1–J4 or sample, period, owner, source URL) · `idea` (batch, date, kind, layout, pillar, hook, networks, languages, status) · `post` (batch, brand, idea, language, linked post, networks, date, status, current version, kit version, flags) · `post_version` (**append-only**: number, content = post.json v2, author member or AI task, reason, changed fields) · `render` (content hash, size, format, storage key, fit report, renderer and look versions; reused by every version with the same hash) |
| **Review** | `approval` (post, version, member or reviewer, kind: agency / client / on the client's behalf + reason) · `review_link` (batch, **token hash**, expires, revoked, created by) · `review_link_post` · `review_visitor` (link, name, email from the first visit) · `comment` (post, slide, member or visitor, text, resolved) |
| **Output** | `export` (batch, by, formats, posts, status, expires) · `export_file` · `public_image` (random name, export, **delete after**: last post date + 7 days) |
| **Messages** | `notification` (user, type, data, read) · `notification_setting` (user, type: instant / digest / off, per channel) · `email_message` (an outbox: template, to, reply-to, status, provider id), so a retried job never sends twice |
| **Running and measuring** | `ai_usage` (§09) · `policy_event` (§22) · `audit_event` (append-only: who, what, when, from which account or link; §11's "what gets recorded") · `app_event` (product events for §01's success measures and §23's onboarding steps) · `usage_counter` (workspace, period, posts, storage, for §02's quotas) · `bangla_verdict` (Zeus's weekly reads, §09) · `problem_report` (§23) |

- **Statuses change in one place:** `packages/core` holds the post status machine (§11). Every change goes through it,
  writes an `audit_event`, and is refused if the move isn't allowed (an unapproved post can't become Exported).
- **Deleting:** deleting a brand deletes its posts, files, examples and lessons (§09). How long a deleted workspace is
  kept before it's gone for good is decided in §16.
- The job queue keeps its own tables in a separate `pgboss` schema.

### Keeping workspaces apart (enforced twice)

1. **In the app:** every query goes through one helper, `db.forWorkspace(ctx)`, which adds the workspace to every
   read and write. Importing the raw database client outside `packages/db` is a lint error (the `tenant-isolation` skill, §19).
2. **In Postgres:** **row-level security** on every workspace table, with the policy
   `workspace_id = current_setting('app.workspace_id')::uuid`. The app connects as a role that can't bypass it, and
   every transaction sets the workspace first (`set_config(…, true)`, so it never leaks to the next request on the
   same connection). Jobs carry the workspace id and set it the same way.
3. **Files:** every key starts with `ws/<workspace id>/`, and the browser only ever gets short-lived signed links.
4. **Zeus's admin panel** (§15) reads across workspaces through a separate database role, and every such read is audited.
5. **Tests:** `tests/tenancy/` signs in as workspace A and tries every route, action and job with workspace B's ids.
   Each attempt must fail. This suite runs on every PR.

### Sign-in and sessions

- **Better Auth**, with Google sign-in and emailed sign-in links (§23). **No passwords**, so there is nothing to leak or reset.
  Sessions are stored in Postgres; cookies are HttpOnly, Secure, SameSite=Lax.
- **Invite-only at launch:** an agency owner needs an invite code from Zeus; a team member needs an invitation (one
  use, tied to the email address, 7 days).
- Workspaces and roles use Better Auth's organization feature: workspace = organization, with the four roles of §01. The
  checks themselves live in `packages/core/permissions` (the matrix comes from §15). Whether one person can belong to
  several workspaces is §15's call; the tables allow it.
- **Every server action and route checks the session and permission itself.** Next.js's `proxy.ts` (formerly
  middleware) only redirects; it is never the only check (a 2025 Next.js flaw let requests skip middleware).
- **Client reviewers** have no account. Opening a review link checks the token's hash and sets a cookie valid only for
  that link. With it they can see the posts sent, approve, request changes, comment and send photos. Nothing else.

### Jobs

- **pg-boss** on the same Postgres. Queues: `ai` (each §09 task), `render`, `fetch` (worker → fetcher), `export`,
  `email`, and scheduled jobs (weekly lessons, client reminders, link and export expiry, deleting public images,
  daily usage counters).
- **A batch fans out** into one pipeline per post (§09: write → images → render → fit fix → QC). **At most 4 posts at
  a time per workspace**, using pg-boss's group concurrency (one group per workspace), so one agency's 100-post
  month can't hold up everyone else. It can briefly run a fifth under load, which is fine: AI cost caps are separate (§22).
- **Every job is safe to run twice:** the payload holds ids only (never content), a step that already has its result
  for that version is skipped, and renders are keyed by content hash. Retries are bounded with backoff; a job that
  keeps failing marks the post Failed with a plain reason (§11).
- **Progress in the app:** screens that show progress (a generating batch, the editor's render status, "Nadia is editing")
  ask the server every 2 seconds. Live push (server-sent events) can come later if it's needed.

### File storage

- **One private bucket** for everything, with keys
  `ws/<workspace>/brands/<brand>/assets/<asset>/{original,1600,360}`, `ws/<workspace>/renders/<hash>.{png,jpg,pdf,webp}`,
  `ws/<workspace>/exports/<export>/…`.
- **Uploads** go straight from the browser to the bucket through a signed link that limits size and type. The worker
  then checks the content, re-encodes it and makes the copies (§10). Until then the file can't be used.
- **Downloads** use signed links that last 15 minutes. Export download links last 7 days (§12).
- **A separate public bucket** holds only the finished JPEGs of exported posts for Metricool (§12), under random
  names, deleted on their date by a scheduled job. Nothing else is ever public.
- Development uses **SeaweedFS** (Apache-2.0) as a local S3-compatible server in Docker Compose. MinIO, the usual
  choice, has been archived and no longer ships images.

### The app's API

- The app's own pages use **server actions and route handlers**; there is **no public API at launch** (v2).
- Every input is checked with zod at the edge. Every handler starts with the same guard: session, workspace, permission.
- Routes: `/app/…` (signed in) · `/r/[token]` (client review: noindex, no referrer, rate-limited) ·
  `/api/uploads` (signed upload links) · `/api/health` · `/api/webhooks/…` (the email provider's bounce reports;
  billing later).
- **Rate limits** live in a Postgres table (one server at launch): sign-in, review links, uploads, and anything that starts AI work.
- Client replies to emails go straight to the batch owner (Reply-To, §11), so there is no inbound email to handle.

### Security summary

| Risk | Control |
|---|---|
| One agency sees another's data | the scoped helper + row-level security + the tenancy test suite |
| A review link is guessed or shared | 128-bit tokens stored hashed, expiry, revoke, rate limits; the link only reaches that batch's sent posts |
| Website reading attacks our servers (SSRF) | the fetcher holds nothing and can only reach the public internet; `safe-fetch` rules |
| A malicious upload | content-type sniffing, size limits, re-encoding, SVGs loaded only as images (§10) |
| Cross-site scripting | React escaping, a strict content security policy with nonces, `dangerouslySetInnerHTML` banned by lint |
| Prompt injection | §22: untrusted text is data, no acting tools, output checks |
| Leaked secrets | secrets only in the server's environment (§14), checked at startup by `config/env.ts`; the AI key only in the worker; gitleaks in CI |
| Vulnerable dependencies | pinned lockfile, audits, the licence allowlist (§20); framework security releases within 2 days if critical |
| Framework caching leaks data between workspaces | no Next.js shared caching of workspace data (lint rule); pages with workspace data render per request |
| Personal data in logs | no post text or emails in logs; Sentry scrubs personal data |

### Environments

- **Development:** Docker Compose with Postgres, the local file store, **Mailpit** (catches every email) and the
  **mock AI provider**. Seed data: Northwind Social and its 3 brands (§21).
- **CI:** the same Compose file. **Staging and production:** §14.
- `config/env.ts` lists every setting with a zod schema; a missing or malformed setting stops the app at startup, and
  `.env.example` is generated from it.

### What happens to the assumptions (A1–A15)

| # | Assumption | Now |
|---|---|---|
| A1 | pnpm monorepo | **Decided**, layout above (adds `apps/fetcher`, `packages/core`, `auth`, `email`, `storage`) |
| A2 | Next.js + React + TypeScript strict | **Decided**: Next.js 16.4, React 19.3 |
| A3 | Tailwind + shadcn/ui + Lucide + Inter | **Decided** for the code; the design itself is confirmed by the §05 mockups |
| A4 | Postgres + Drizzle | **Decided**: Postgres 18, Drizzle 0.45. Whether drizzle-kit writes the security policies into migrations is checked in M0; if not, those migrations are written in SQL by hand |
| A5 | Better Auth | **Decided**, with invitations set to 7 days (its default is 48 hours) and sign-in links to 10 minutes, single use |
| A6 | pg-boss | **Decided**: version 12, per-workspace group concurrency |
| A7 | Vitest, Playwright, Storybook | **Decided** as tools; how much testing is §17 |
| A8 | `DESIGN.md` tokens | Unchanged; confirmed with §05 |
| A9 | Anthropic SDK, config files | **Decided** in §09 |
| A10 | One headless-Chrome worker | **Replaced** by A15: renders in the worker, website reading in the fetcher |
| A11 | Docker on Hetzner, Caddy, R2, Sentry, Resend | Caddy, R2, Sentry and Resend **decided** here; servers, sizes and region are §14 |
| A12, A13 | Playwright in Docker; React layouts | **Decided** in §08 |
| A14 | sharp's LGPL libvips; HEIC | **Decided**: LGPL exception, HEIC decoded on the server (below) |
| A15 | Two separate browsers | **Decided**: the fetcher process |

### Decided by Zeus (2026-11-06): LGPL libraries and iPhone photos (A14)

sharp's ready-made builds include libvips under the LGPL and **can't read HEIC** (confirmed). iPhones usually convert
photos to JPEG when they're uploaded from a phone's browser (to test), but HEIC files still arrive from Macs and file
shares.

- **Chosen:** allow LGPL libraries used unchanged as separate shared libraries (libvips; for HEIC also libheif and
  libde265, decoding only) as a named exception to §20's licence rule. The worker image builds libvips with HEIC
  decoding. §16 notes that HEVC (the format inside HEIC) is covered by patents; decoding-only use is common, but it's on
  the legal checklist.
- **Not chosen:** no HEIC on the server. A HEIC upload gets "Please send this photo as a JPEG" with how-to steps, and §10
  changes.

### Found for §14

Hetzner raised its prices twice in 2026 (April, also for existing servers; June, for new orders). Its Singapore
location (closer to Bangladesh) offers only the CPX and CCX lines, costs more, and includes less traffic (1 TB on
CPX22, with extra traffic at €7.40/TB against €1/TB in the EU). §14 weighs this against an EU location.

## Not in the MVP

A public API · live push updates · several servers (one web and one worker at launch; the design allows more) ·
single sign-on (SAML) · passwords and two-factor codes of our own (Google's protects Google sign-in) · data stored in a
region the customer picks.

## Done when

- The repo layout, `config/env.ts`, Docker Compose and the seed data exist (H0/M0), and `pnpm check` runs on them.
- The tenancy suite fails a deliberately broken query (one that drops the workspace filter) in two ways: by the lint
  rule and by row-level security.
- The fetcher container has no database or file-store credentials, and a test page that tries to reach
  internal addresses gets nothing.
- A job killed halfway and retried produces no duplicate posts, renders or emails.
- The status machine refuses every move §11 doesn't allow, and every move writes an audit event.

## Depends on

§01, §06–§12, §19–§23 (what the architecture serves). Feeds §14 (where it runs), §15 (permissions, admin), §16
(retention), §17 (tests) and §02 (quotas).
