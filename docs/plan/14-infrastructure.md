# Section 14: Infrastructure and operations (Approved 2026-11-06)

**Goal:** where LetZeusPost runs, how code gets there, how data is backed up and restored, how problems are noticed
and handled, where secrets live, and what it costs each month. Built to be run by one person with AI help.

## Decided earlier

| Topic | Decision | Where |
|---|---|---|
| Processes | `web`, `worker` (AI, renders, exports, emails; the only holder of the Anthropic key), `fetcher` (internet only, no database, files or secrets); Postgres with pg-boss; Caddy | §13 |
| Region | **EU**: servers in Germany or Finland, Cloudflare R2 **EU** buckets, backups in the EU | §16 |
| Retention | Backups at most **30 days**; server logs 30 days; deleted workspaces erased after 30 days | §16 |
| Rendering | Playwright + pinned Chromium in Docker, the same image as the visual tests; up to 4 pages per worker | §08 |
| HEIC | Converted by **Cloudflare Images** | §16 |
| Merging | Zeus merges every PR; agents never deploy | §20 |
| Domain | `letzeuspost.com` public page, `app.letzeuspost.com` the app, DNS at Cloudflare | §03 |
| Costs to watch | AI caps per workspace and $100 a day overall (§22, §02); staging and evals on their own Anthropic key with a spend limit (§20) | |

## Spec

### Servers (Hetzner Cloud, EU)

Prices checked 2026-11-06 (per month, excluding VAT; 20 TB traffic included).

| Server | Plan | Size | Price | Where |
|---|---|---|---|---|
| **Main** | CX43 | 8 shared vCPU, 16 GB, 160 GB NVMe | €16.49 | Nuremberg (NBG1) |
| **Fetcher** | CX23 | 2 shared vCPU, 4 GB, 40 GB | €5.99 | Nuremberg, same private network |
| **Staging** | CX23 | 2 shared vCPU, 4 GB, 40 GB | €5.99 | Nuremberg |

**On 2026-11-06 Hetzner showed the CX line as "currently unavailable" to order.** If that's still so when Zeus
orders: CPX32 (4 vCPU, 8 GB, €35.99) for the main server and CPX12 (1 vCPU, 2 GB, €11.99) for the fetcher and staging.
With 8 GB the worker runs at most 2 render pages and 1 cutout at a time. (CX is only in Nuremberg and Helsinki.)

- **Two production servers, not one:** the **fetcher** gets its own small server, because it opens strangers'
  websites in a browser. If a malicious page broke out of that browser, it would land on a machine that holds no
  database, no files and no keys. It's reachable from the main server only over Hetzner's **private network**, and
  only with a shared token.
- **x86, not ARM:** CI's golden renders run on x86, and renders must match pixel for pixel (§08).
- Shared vCPUs can be slowed by neighbours. If renders miss §08's target (95% within 1.5 s per slide), the main server
  moves to the dedicated-vCPU line (CCX), and the change is noted here.

### What runs where

```
Cloudflare (DNS, proxy, TLS edge)          Cloudflare Pages: letzeuspost.com (the one public page)
        │ app.letzeuspost.com
 ┌──────▼─────────────────────── main server (EU) ──────────────────────────┐
 │ Caddy ─► web (Next.js standalone)                                          │
 │          worker (pg-boss jobs; Chromium for renders, no internet;          │
 │                  outbound only through the egress proxy)                   │
 │          Postgres 18 (+ pgBackRest backups) · egress proxy (Smokescreen)        │
 └──────┬────────────────────────────────────────────────────────────────────┘
        │ private network, token                         R2 (EU): files, exports, backups
 ┌──────▼──── fetcher server (EU) ───┐                   Cloudflare Images: HEIC → JPEG
 │ fetcher (Chromium, internet only, │                   Anthropic · Resend · Sentry (outbound from the worker)
 │ private addresses blocked)        │
 └───────────────────────────────────┘
```

- **Docker Compose** on each server, one file per server in `docker/`. CI builds the images once, pushes them to
  GitHub's container registry (free for now), and the servers pull exactly the images CI tested.
- **The public page** is a static site on **Cloudflare Pages** (free), so it stays up even when the app is down.
- **Outbound traffic** from the worker goes through an egress proxy (**Smokescreen**) that allows only the services
  it needs: the Anthropic API, R2, Cloudflare Images, Resend, Sentry and the fetcher. The fetcher's own proxy allows
  the public internet and blocks private addresses, including Hetzner's metadata address `169.254.169.254`. This backs
  up `safe-fetch` (§06) at the network level.

### Network and server hardening

- **Hetzner Cloud Firewall** (it runs on Hetzner's hosts, so Docker can't open ports around it): the main server
  accepts 80/443 only from Cloudflare's addresses and SSH only from Zeus's address list; the fetcher accepts nothing
  from the internet.
- **Host firewall too,** because Hetzner's firewall doesn't filter the private network or metadata requests: on the
  fetcher, its port answers only the main server's private address, and its containers can't reach
  `169.254.169.254` (rules in Docker's `DOCKER-USER` chain, so Docker can't skip them).
- SSH with keys only, no root login, a `deploy` user with Docker rights only. Automatic OS security updates with a
  weekly reboot window (Sunday 04:00 Dhaka). Containers run as non-root with read-only file systems where possible.
- Postgres listens only on the internal Docker network; nothing database-related is reachable from outside.
- Cloudflare's proxy in front of the app: TLS, basic DDoS protection and the rate limits on the review links (§11) at
  the edge as well as in the app.

### Environments

| Environment | Where | Data | AI |
|---|---|---|---|
| Development | Zeus's Mac, Docker Compose (Postgres, SeaweedFS, Mailpit) | seed data (§21) | mock provider (§20) |
| CI | GitHub Actions, the same Compose file | seed data | mock; evals on their own key (§22) |
| **Staging** | its own small server, `staging.letzeuspost.com`, behind Cloudflare Access (Zeus only) | seed data and test brands, **never customer data** | real, on the **staging key** with a monthly limit |
| **Production** | the two servers above | customers | real, on the production key |

### Deploys

1. Zeus merges a PR to `main` (§20).
2. CI builds the images and runs the checks; on green, **staging deploys automatically** and a smoke test runs
   (sign in, generate one post with the mock, render, export).
3. **Production deploys when Zeus runs the "Deploy production" workflow** on `main`. The manual trigger is the
   approval, since GitHub Free has no deployment environments for private repos. It's never automatic. The SSH deploy
   key is used only by that workflow, and builders can't edit workflows (§20), so code in a PR can't reach it.
4. On the server: back up the database (a fresh pgBackRest backup), run the migrations (expand-then-contract, §20's
   `safe-migrations`), start the new containers, check `/api/health`, and **roll back automatically** to the previous
   images if the check fails within 2 minutes.
5. A deploy causes a few seconds of restart; Caddy retries in the meantime. Big changes go out in the Sunday window,
   announced with the banner (§15).

Next.js self-hosting settings that must be set: `output: "standalone"`; a fixed `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
and a `deploymentId` so pages open during a deploy keep working; Caddy's buffering off for streamed responses; sharp's
memory settings on Linux (`MALLOC_ARENA_MAX=2` or jemalloc).

### Backups and restore

- **Postgres:** **pgBackRest** (MIT; supports Postgres 18) to an R2 EU bucket: a full backup weekly, a differential
  one nightly, and the write-ahead log archived continuously, so at most **5 minutes** of data can be lost. Encrypted
  before upload; kept **30 days** (§16). (WAL-G was the first idea; an open report of it hanging on R2 tipped it.)
- **Files on R2:** R2 keeps redundant copies itself, and deleting in the app is a 30-day soft delete (§16). R2 has
  **no file versioning**, so a nightly copy (rclone `sync` with a backup folder) keeps every changed or deleted file
  for 30 days in a separate backups bucket, written with its own key that the app never holds.
- **Config:** everything except secrets is in the repo; secrets are re-creatable from the list below.
- **Restore drills:** an **automatic weekly restore** of the latest backup into a throwaway database on staging, which
  checks row counts and a sample of records and reports in the weekly report (§19). A **manual drill every 3 months**
  (Zeus + Athena): rebuild production on a fresh server from backups and the repo, timed. **Target: back online
  within 4 hours, at most 5 minutes of data lost.**

### Monitoring and alerts

| What | How | Alert |
|---|---|---|
| Is the app up? | UptimeRobot (free, commercial use allowed): `/api/health` and the review page every 5 minutes | email + phone push to Zeus after 2 failures |
| Errors | Sentry (EU region, personal data scrubbed) | new error types and spikes |
| Jobs | the worker's heartbeat; queue depth and age; failed jobs | a job older than 15 minutes, or more than 5% failing |
| Server | disk, memory and CPU, checked every 5 minutes by a small script | disk over 80%, memory over 90% for 10 minutes |
| Backups | pgBackRest's last success; the nightly file copy | either missing for 26 hours |
| AI spend | the §22 caps | 80% of the daily cap, and any cap hit |
| Renders | §08's timing | 95th percentile over 1.5 s for an hour |

All of it also shows in the admin panel (§15) and the weekly report. **No status page at launch**: the banner (§15)
and email cover incidents.

**Uptime target: 99.5% a month** during the partner phase (about 3.5 hours of downtime). Zeus is the only person on
call; partners are told that problems are handled during Dhaka daytime, faster for outages.

### When something goes wrong (incident and breach runbook)

1. **Notice:** an alert, a partner's email or a problem report (§23).
2. **Contain:** turn on **maintenance mode** (a switch in the admin panel: the app shows the banner and stops
   generation; review links show a short notice). For a suspected breach: rotate the affected keys, revoke sessions,
   and keep the logs.
3. **Assess:** what happened, which workspaces and data, since when. Athena helps read the logs.
4. **Tell people:** affected agencies **within 48 hours** of confirming a breach (§16); Bangladesh's Authority when
   significant harm is likely; partners by email for outages longer than 30 minutes.
5. **Fix and review:** the fix goes through the normal PR path (Zeus merges); a short write-up in the repo
   (`docs/incidents/`), and a follow-up task so it can't happen the same way again.

### Secrets

- **Production and staging:** one env file per server (`/etc/letzeuspost/*.env`, root-only), loaded by Compose. Each
  process gets only what §13 says it holds; the fetcher gets none except its token.
- **CI:** GitHub Actions secrets: the SSH deploy key, the eval key (§22) and the review token (§20). No production
  database or AI key in CI.
- **Zeus's Mac:** the macOS Keychain (the builder token, §20).
- `config/env.ts` (§13) checks every value at startup. Keys are rotated every 6 months and after anyone leaves or any
  suspected leak; the list of secrets and how to recreate each is in `docs/ops/secrets.md` (names only, never values).

### Email and DNS

- **Sending:** Resend, from a subdomain of `letzeuspost.com`, with SPF, DKIM and DMARC (start at `p=none`, move to
  `quarantine` once reports are clean). Resend sends from its EU region but **stores email data in the US** (no EU storage option), which §16's
  sub-processor list says.
- **Receiving:** `zeus@`, `hello@` and `privacy@` forward to Zeus's inbox through Cloudflare Email Routing (free).
- **DNS** at Cloudflare: the public page, `app.`, `staging.`, the email records.

### Monthly cost (launch, design-partner phase)

| Item | Choice | Per month |
|---|---|---|
| Main server | Hetzner CX43 | €16.49 (fallback CPX32: €35.99) |
| Fetcher server | Hetzner CX23 | €5.99 (fallback CPX12: €11.99) |
| Staging server | Hetzner CX23 | €5.99 (fallback CPX12: €11.99) |
| Files and backups | Cloudflare R2, EU | about $0–5 (10 GB free, then $0.015 per GB, no egress fees) |
| HEIC conversion | Cloudflare Images | $0 (5,000 conversions a month free) |
| Public page, DNS, email forwarding, staging access | Cloudflare Pages, DNS, Email Routing, Access | $0 |
| Email | Resend | $0 (3,000 a month, 100 a day); $20 on Pro when sending grows |
| Errors | Sentry Developer, EU region | $0 (1 user, 5,000 errors) |
| Uptime | UptimeRobot | $0 |
| Code, CI, images | GitHub Free | $0 ($12 of Actions compute included, about 2,000 Linux minutes; if heavy test runs exceed it, a self-hosted runner on its own small server, about €6) |
| Domain | letzeuspost.com | about $1 (yearly) |
| Staging and eval AI | Anthropic, separate key | at most $75 (the limit, raised in §17) |
| **Total** | | **about €29 + $0–25, plus at most $75 of test AI** (fallback servers: about €60 + the same) |

Later, when an EU or UK agency joins: the two representatives, about €70 a month together (§16).

AI usage is paid per post and covered by the plans (§02); it isn't infrastructure. The next steps up, when needed:
a dedicated-vCPU main server, a separate worker server, then a managed Postgres.

### When to grow

| Sign | Step |
|---|---|
| Renders miss the target, or CPU above 70% for days | main server to dedicated vCPUs (CCX), or the worker to its own server |
| Database over 50 GB or slow queries | a bigger disk or a Hetzner volume; later a managed Postgres in the EU |
| More than about 20 active agencies | a second web process behind Caddy (needs the shared Next.js cache settings from §13) |

## Not in the MVP

Kubernetes · several regions · a status page · a 24/7 on-call · a log platform (logs stay on the servers for 30 days,
errors go to Sentry) · infrastructure-as-code beyond the Compose files and a setup script.

## Done when

- `docker/` has the Compose files and a setup script that turns a fresh Hetzner server into a working main or fetcher
  server; staging is built with it.
- A deploy to staging and to production works from GitHub, including the automatic rollback on a failed health check.
- The firewall rules are tested: Postgres and the fetcher are unreachable from the internet; the fetcher can't reach
  private addresses or the metadata address; the worker can't reach anything outside its list.
- The first automatic restore passes, and the first manual drill is timed and written up.
- Every alert in the table fires in a test.

## Depends on

[08](08-render-engine.md), [13](13-architecture.md), [15](15-accounts-and-admin.md), [16](16-legal-and-trust.md),
[20](20-builder-guardrails.md), [22](22-product-ai-guardrails.md). Feeds §17 (staging for end-to-end tests) and §18
(the launch checklist).
