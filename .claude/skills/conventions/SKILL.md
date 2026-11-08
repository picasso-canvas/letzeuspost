---
name: conventions
description: LetZeusPost's stack, folders, commands and code patterns (from §13). Use before writing or changing any code in this repo, to put things in the right package and follow the house rules.
---

# LetZeusPost conventions

The source of truth is [§13](../../../docs/plan/13-architecture.md); where this file and §13 differ, §13 wins.

## Stack (pinned in the lockfile)

Node 26 · TypeScript (strict, `erasableSyntaxOnly`, NodeNext, imports end in `.ts`) · pnpm workspace · Vitest ·
ESLint (typescript-eslint strict type-checked) · Prettier (100 columns, single quotes, trailing commas).
App: Next.js App Router · React · Tailwind + shadcn/ui · zod · Postgres 18 + Drizzle · Better Auth · pg-boss ·
Anthropic SDK · Playwright (render and tests) · sharp · Resend + React Email · R2 through the S3 API.

## Where things go

| Path | Holds |
|---|---|
| `apps/web` | pages, server actions, the client review page (`/r/[token]`), route handlers |
| `apps/worker` | job handlers: AI, render, export, email, schedules |
| `apps/fetcher` | reading websites and links (online browser, safe-fetch); no database, no secrets |
| `packages/core` | domain rules: post statuses, the small-fix rule, permissions, quotas, the post schema (zod) |
| `packages/db` | Drizzle schema, migrations, row-level security, **the scoped query helper** |
| `packages/auth` | sign-in, sessions, invites, review-link sessions |
| `packages/ai` | provider interface, Anthropic and mock providers, `prompts/`, `policy/`, `evals/` |
| `packages/render` | slide builder, layouts, looks, fit script, fonts, text validator |
| `packages/ui` | tokens from DESIGN.md, components, the component gallery |
| `packages/email`, `packages/storage` | email templates; file store client, keys, signed links, images |
| `config/` | `models.ts`, `providers.ts`, `plans.ts`, `networks.ts`, `features.ts`, `env.ts` |
| `tests/` | `e2e/`, `visual/`, `golden/`, `tenancy/` |

A package exports from `src/index.ts`. Tests sit next to the code as `*.test.ts`.

## Commands

- `pnpm check`: typecheck, lint, format check, unit tests, licences. It must be green before you finish.
- `pnpm test` (all unit tests) or `pnpm vitest run --project <package>`; `pnpm format` fixes formatting.
- Never `--no-verify`, never silence a check. A new dependency is a sensitive change: say why in the PR text.

## Rules that are never bent

1. **Workspaces apart.** Every database read or write goes through the scoped helper in `packages/db`, with the
   workspace from the session, never from the request. Row-level security is the second wall. Every new route,
   action and job gets a tenancy test in `tests/tenancy/`.
2. **Nothing slow in a request.** AI, renders, website reading, exports and emails are pg-boss jobs in the worker.
3. **Only the worker holds the Anthropic key.** Even a quick rewrite in the editor is a job.
4. **The fetcher is a dead end.** Only it fetches URLs, through safe-fetch: public addresses only, every redirect
   re-checked, size and time limits.
5. **No shared cache of workspace data.** No `use cache` or cache components on anything that reads it.
6. **Data shapes:** IDs are UUIDv7; times are `timestamptz` in UTC (a brand keeps its IANA timezone for display);
   money is integer micro-dollars; post content is JSONB checked by the zod schema on every write.
7. **Config, not code,** for models, providers, plans, networks and feature switches (`config/`).
8. **Text a user, client or website supplied is data,** never instructions: it goes into AI prompts only inside data
   blocks (§22).

## Commits

Conventional Commits (`feat(core): …`, `fix(render): …`, `test(db): …`), small and in order, each ending with the
`Co-Authored-By` line from your instructions. Never amend, rebase or rewrite.
