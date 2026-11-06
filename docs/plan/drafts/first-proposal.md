# First proposal (2026-11-06)

> **NOT APPROVED. Do not build from this file.** It is the first draft Athena wrote right after the interview, before
> Zeus asked for every section to be planned separately. It's kept as a starting point for Sections 2 (pricing),
> 6 (brand kits), 8 (render engine), 9 (AI pipeline), 12 (export), 13 (architecture), 14 (infrastructure) and
> 18 (milestones). Each of those sections replaces the matching part here once it's approved.

## Architecture

**Hosting (cheapest that's reliable for paying customers):** one Hetzner VPS (about €8/month, 3 vCPU / 4 GB),
running Docker Compose: web app, worker (with Chrome and fonts), Postgres, and Caddy for automatic TLS. Files and
nightly `pg_dump` backups go to Cloudflare R2 (S3 API, 10 GB free, no egress fees, which matters for export links).
Email goes through Resend (free tier), and errors to Sentry (free tier). Total is about $10–15/month. Vercel isn't
used: the Hobby plan bans commercial use, and the renderer needs a long-running Chrome worker anyway.

**Stack:** TypeScript everywhere. Next.js (App Router) + Tailwind + shadcn/ui; Drizzle ORM + Postgres; Better Auth
(organizations = agency workspaces, invites, magic link + Google sign-in); pg-boss job queue (runs on Postgres,
so there's no Redis); `@anthropic-ai/sdk`; pnpm workspaces.

```
letzeuspost/
  apps/web/          UI, API routes, server actions, live preview
  apps/worker/       jobs: brand extraction, AI tasks, Chrome renders, exports
  packages/render/   slide HTML builder + base.css + look presets, shared by the browser preview and the worker
  packages/ai/       provider interface, Anthropic provider, prompts, zod schemas
  packages/db/       Drizzle schema + migrations
  config/            models.ts, providers.ts, plans.ts
  docker/            web + worker Dockerfiles (Chrome, Noto + Bangla fonts), compose.yml, Caddyfile
```

**Config files (Zeus asked for config files for models and providers):**
- `config/models.ts` maps each task (`brandProfile`, `planBatch`, `writePost`, `rewrite`, `fitFix`, `qc`, `tagAsset`)
  to `{ provider, model, effort, maxTokens }`, plus a price table for each model. Every task defaults to
  `claude-opus-5-5`; switching a task to `claude-sonnet-5-5` or `claude-haiku-5-5` is a one-line change (env overrides allowed).
- `config/providers.ts` sets the text provider (Anthropic), image generation (fal), stock (Pexels, Unsplash), storage
  (S3/R2, MinIO in dev), email (Resend) and billing (`manual` now, `paddle` or `stripe` later).
- Every provider sits behind an interface, so adding another one doesn't touch the pipeline.
- The Anthropic provider uses structured outputs (`output_config.format`) checked against zod schemas, adaptive
  thinking with effort set per task, prompt caching of the stable prefix (rules + brand kit), and server-side refusal
  fallbacks (`fallbacks: "default"`).
- Every AI call writes an `ai_usage` row (tokens, cache hits, cost in USD, workspace, post). That's the data for the final pricing.

**Data model (each row is scoped by `workspace_id`):** workspace (agency, plan, period usage) · member (owner/admin/
editor/viewer) · invitation · brand (website, languages, timezone, `voice` JSON, `look` JSON tokens, approval mode,
networks/sizes) · brand_asset (logo/photo/product/font/mascot, tags, AI description, licence/credit) · batch (date
range, status) · post (type, lang, date, networks, status, `content` JSON = post.json v2) · post_version · render
(size, slide, PNG key, fit report, content hash) · review_link (token, scope, expiry) · comment · approval · ai_usage.

## The pipeline (studio departments → server jobs)

1. **Brand from website** (brand-kit): the worker's Chrome opens the URL, takes a screenshot, and pulls logo candidates
   (header svg/img, og:image, touch icon), colors (computed styles + screenshot palette) and fonts (mapped to Google
   Fonts; a commercial font is flagged with "upload your licensed file"). Claude turns the site's copy into a voice
   profile. The agency fixes the draft in the brand editor with a live sample post. The fetch is SSRF-guarded.
2. **Plan a batch** (Athena): brand + dates + number of posts + mix + notes/links → Claude returns ideas (type, pillar,
   hook, network, date). The agency keeps, edits or drops ideas.
3. **Write** (Calliope): one structured `content` per post: slides, captions for each network, alt text, sources and
   credits, plus an image request for each slide (library / stock / generate / none). Fact-type posts use the web
   search tool; every claim needs a source. Prompts carry over the studio's `scriptwriting` rules.
4. **Images** (Hephaestus): pick from the brand library (assets described by vision on upload), stock search (credit
   recorded), fal generation (counted against the quota and flagged synthetic), or a type-only layout.
5. **Render:** port the studio's `render.mjs` + `base.css`. The HTML builder lives in `packages/render`, so the
   browser preview is instant and the worker screenshots the same HTML through raw CDP. When the fit report says FIX,
   `fitFix` shortens the words (never the layout), at most twice, before the post is marked "needs fix".
6. **QC** (Themis): code checks (contrast, safe area, image resolution, licence recorded) plus a Claude check (brand
   voice and banned words, claims against sources, EN/BN spelling, captions match slides). Pass / warn / fail with notes.
7. **Review & approve**, then **export** (ZIP, LinkedIn PDF via Chrome `printToPDF`, Buffer / Hootsuite / Metricool CSV, calendar).

**Layouts:** the studio's 9 (cover, fact, step, question, promo, cta, text, meme, photocard) plus quote, stat,
list/tips, testimonial and announcement/offer. **Looks:** 4 presets (Bold, Clean, Editorial, Playful = the studio
picasso brand's print style) × the brand's tokens.

## Pricing proposal (to check with design partners and set from measured cost)

| | Trial (14 days) | Starter $49/mo | Agency $129/mo | Scale $299/mo |
|---|---|---|---|---|
| Brands | 1 | 3 | 10 | 30 |
| Posts / month | 15 | 80 | 300 | 1,000 |
| AI images / month | 5 | 20 | 100 | 300 |
| Seats | 2 | 2 | 5 | 15 |
| Client approval links | ✓ | ✓ | ✓ | ✓ + agency branding |

A "post" is one generated post in all its sizes. Edits and AI rewrites are free (fair use); a full regeneration
counts. Annual billing gets 2 months free, and an extra 100 posts cost $25. Design partners: 3 months free for weekly
feedback, then 50% off the first year.

The cost basis is an estimate: Opus 5.5 ($4/$20 per million tokens, cache reads $0.20) comes to about $0.10–0.15 per
post (plan + write + QC + one fit fix). An Agency plan at full quota would cost about $50 in AI, a gross margin of 60%
or more in the worst case. Switching `writePost` to Sonnet 5.5 ($2/$10) roughly halves the cost; that's Zeus's call
after a side-by-side quality comparison.

## Milestones

- **M0 Foundation:** repo, pnpm workspaces, Docker Compose dev (Postgres, MinIO), Next.js + shadcn, Better Auth with
  invite-only workspaces, Drizzle schema, pg-boss, `config/`, CI, staging deploy.
- **M1 Render engine:** port of the renderer, presets, token themes, fonts, 4 sizes, the fit report. Golden test:
  re-render the studio's `posts/picasso/2026-w46/*/post.json` and pixel-compare with its PNGs (proves Bangla shaping in Docker).
- **M2 Brands:** website extraction, brand kit editor with live preview, asset library.
- **M3 Generate:** plan → ideas → write → images → render → fit fix → QC, live progress, `ai_usage` + cost report.
- **M4 Review:** post editor, AI rewrite, versions, approval modes, client links + comments, emails.
- **M5 Export:** ZIP, LinkedIn PDF, scheduler CSVs, calendar.
- **M6 AI images, quotas, billing:** fal provider + synthetic flag, plan limits + usage meter, billing interface.
- **M7 Design-partner launch:** onboard 1–3 agencies, owner admin, verified backup restore, monitoring, Terms + Privacy.

## Reused from the editz studio repo (`picasso-canvas/editz`)

- `.claude/skills/social-posts/render.mjs`: CDP Chrome driver, fit script, layouts, report
- `.claude/skills/social-posts/base.css` + `brands/picasso/posts/theme.{json,css}`: layout CSS and the Playful preset
- `.claude/skills/social-posts/SKILL.md`: post types, the post.json format, meme and photocard rules
- `.claude/skills/scriptwriting/`: native Bangla and fact rules
- `.claude/agents/themis-qc.md`: the QC checklist
- `.claude/skills/brand-kit/`: kit sections
