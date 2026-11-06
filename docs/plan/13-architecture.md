# Section 13: Technical architecture (Draft: assumptions only, not approved)

> This doc is **not approved**. Planning Part F (19–22) early made it lean on stack details nobody had decided. They
> are collected here as **open decisions**, so no agent treats them as settled. Section 13 is planned properly in its
> turn (after 12 and 8), and its approved answers override anything in 19–22.

**Goal (when planned):** stack, repo layout, data model, auth and workspaces (multi-tenancy), the job queue, file
storage, the API, and security.

## Assumptions Part F currently makes

| # | Assumption | Used in | Source | To decide |
|---|---|---|---|---|
| A1 | One pnpm monorepo: `apps/web`, `apps/worker`, `packages/ui`, `packages/ai`, `packages/db`, `packages/render`, `config/` | 19, 20 (sensitive paths), 21, 22 | [first proposal](drafts/first-proposal.md) | layout and folder names |
| A2 | Next.js (App Router) + React + TypeScript strict | 19 (skills), 21 | first proposal | framework |
| A3 | Tailwind + shadcn/ui + Lucide + Inter | 21 | [§05](05-app-design.md) direction | confirm in §05 mockups |
| A4 | Postgres + Drizzle ORM with migrations | 19, 20 (squawk, sensitive paths) | first proposal | database + ORM |
| A5 | Better Auth with organizations (agency workspaces), magic link + Google | 19 | first proposal | auth library |
| A6 | pg-boss job queue on Postgres (no Redis) | 19 (`jobs` skill) | first proposal | queue |
| A7 | Vitest (unit), Playwright (end-to-end, visual), Storybook (component gallery) | 20, 21 | first proposal | test tools (with §17) |
| A8 | `DESIGN.md` (google-labs-code format) as the design token spec | 21 | skills research | confirm with §05 |
| A9 | Anthropic SDK with structured outputs; model and provider config files | 22 | interview + first proposal | with §09 |
| A10 | A headless-Chrome worker for brand extraction and post renders (split in A15) | 20, 22 | studio renderer | with §08 |
| A11 | Docker on one Hetzner VPS, Caddy, Cloudflare R2, Sentry, Resend | skills lists in 19 | first proposal | §14 |
| A12 | Playwright driving a pinned Chromium, in one Docker image shared by production renders and the visual tests | 08, 17, 21 | [§08](08-render-engine.md) draft | with §08's approval |
| A13 | Post layouts as React components rendered to static HTML (one builder for the editor preview and the worker) | 08 | §08 draft | with §08's approval |
| A14 | Image encoding with sharp (libvips is LGPL-3.0: needs a licence-allowlist exception, or another encoder); HEIC needs a custom build or a separate decoder | 08, 10, 20 | §08 draft | §13 + Zeus (licence) |
| A15 | Two separate browsers: the render browser with no internet, and the website-reading browser (`safe-fetch`) | 06, 08, 22 | §08 draft | §13 / §14 (containers) |

Everything else in [drafts/first-proposal.md](drafts/first-proposal.md) is also undecided.

## Depends on

§06–§12 (what the architecture has to serve).
