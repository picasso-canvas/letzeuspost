# Research: outside skills for building LetZeusPost (2026-11-06)

**Method:** six research agents read the actual skill, agent, command and hook files of about 100 candidates (not
just READMEs) across design, accessibility, security, engineering, platform and product. Athena then checked every
pick's repo, licence and last push with the GitHub API. The large star counts are real (skills are popular in 2026).
★ = GitHub stars on 2026-11-06. Rating 1–5.

**Verdicts:** USE = vendor a pinned copy as it is · ADAPT = vendor a pinned copy with the listed changes ·
REFERENCE = read it, don't vendor it · SKIP · LATER = when that feature is built. The vendoring rules are in
[20-builder-guardrails.md](../20-builder-guardrails.md#outside-skills).

**Corrections the verification made:** the `openai/skills` repo has no licence at its root, but
`security-best-practices` has its own Apache-2.0 `LICENSE.txt` · `hamelsmu/evals-skills` is **archived** (pinned copy,
no updates) · `better-auth/skills` and `vercel-labs/agent-skills` have **no licence file** · `anthropics/skills`
licenses each skill separately (frontend-design: Apache-2.0) · the squawk linter is `sbdchd/squawk`.

## Design and UI

| Skill (repo → path) | ★ · licence | What it instructs | Safety | Rating | Verdict |
|---|---|---|---|---|---|
| google-labs-code/design.md (spec + `@google/design.md` CLI) | 28.8k · Apache-2.0 | Tokens in YAML + written guidance; `lint` (broken refs, WCAG contrast), `diff`, `export` to Tailwind / DTCG | npm CLI | 5 | **USE**: our `DESIGN.md` |
| shadcn-ui/ui → `skills/shadcn` | 127k · MIT | Semantic tokens only ("never raw values like bg-blue-500"), no manual `dark:` overrides, dialogs need a Title, Empty states; a design-system flow that reports contrast pairs under 4.5:1 | Pre-approves `npx shadcn@latest`; runs `shadcn info` on load (unpinned) | 5 | **USE**: pin the CLI, set Next.js + lucide |
| ibelick/ui-skills → `baseline-ui`, `fixing-accessibility` | 10.7k · MIT | Tailwind + shadcn; "limit accent color usage to one per view", "NEVER use gradients", "NEVER add animation unless explicitly requested" | Markdown only | 5 | **USE** |
| vercel-labs/web-interface-guidelines → `command.md` | 1.1k · MIT | Focus, forms, hit targets ≥ 24 px (44 px mobile), `tabular-nums`, reduced motion, dark mode, i18n; `file:line` findings | `install.sh` writes to home folders: don't run it | 5 | **ADAPT**: pinned copy; sentence case (not Title Case); WCAG 2.2 AA (not APCA) |
| anthropics/skills → `frontend-design` | 188k · Apache-2.0 (per skill) | "AI tells" to avoid, "the brief's own words always win", 4–6 hex tokens, critique from screenshots, "errors don't apologize" | none | 4 | **ADAPT**: remove the "take aesthetic risk" persona; bind to `DESIGN.md` |
| OneRedOak/claude-code-workflows → `design-review/` | 3.9k · MIT | 7-phase Playwright review at 1440/768/375; Blocker/High/Medium/Nit; "problems over prescriptions" | Needs Playwright MCP; the agent has Edit/Write | 4 | **ADAPT**: read-only, mockup diff, light + dark, axe, WCAG 2.2, current tool names |
| pbakaus/impeccable → `audit.md`, `critique.md`, `polish.md`, `quieter.md`, `craft-floor.md` | 104k · Apache-2.0 | Audit scores 5 areas 0–4 with P0–P3; critique scores Nielsen's heuristics with isolated sub-agents | Launcher downloads a binary; telemetry on by default; installs hooks | 4 | **ADAPT**: rubric files only; `DO_NOT_TRACK=1`; no binary or hooks |
| jakubkrehel/make-interfaces-feel-better | 3.9k · MIT | Concentric radii, optical alignment, tabular numbers, interruptible transitions | none | 4 | **USE**; our tokens win (it prefers shadows to borders) |
| emilkowalski/skills → `emil-design-eng`, `review-animations` | 53.9k · MIT | UI motion under 300 ms, ease-out, never animate keyboard actions; "approval is earned" | none | 4 | **ADAPT**: delete the canned first reply |
| Dammyjay93/interface-design | 5.9k · MIT | Product-UI bar (Linear/Stripe), shadcn tokens, ~10% accent, severity review | none | 4 | **REFERENCE**: calls Inter an anti-pattern |
| vercel-labs/agent-skills → `react-best-practices`, `composition-patterns` | 33.6k · **no licence file** | 70 React/Next performance rules; compound components over boolean props | none | 5 / 4 | **REFERENCE** (no licence) |
| s0xDk/refactoring-ui-skill | 688 · MIT | Fixed spacing/type scales, "never invent a value" | own tokens.css | 3 | REFERENCE |
| nextlevelbuilder/ui-ux-pro-max-skill | 146k · MIT | Python search over palettes, fonts and styles | 3.6 MB | 2 | REFERENCE: generates its own palettes and fonts |
| anthropics/skills → `canvas-design`, `theme-factory` | Apache-2.0 | Art-movement posters; preset themes | downloads fonts | 2 | REFERENCE |
| Leonxlnx/taste-skill | 111k · MIT | Maximalist marketing sites | 36 MB; fetches remote images | 1 | SKIP |
| Anthropic cookbook "prompting for frontend aesthetics" | MIT | "Avoid generic fonts like Arial and Inter", "create atmosphere" | — | 1 | SKIP: keep out of `CLAUDE.md` |
| anthropics/skills → `web-artifacts-builder`, `brand-guidelines`, `algorithmic-art` | Apache-2.0 | Vite artifacts; Anthropic's own brand; p5.js | — | 1 | SKIP |
| vercel-labs/agent-skills → `web-design-guidelines` | no licence file | Fetches unpinned rules on every run | supply-chain risk | 2 | SKIP: use the pinned `command.md` instead |

## Social posts and typography

| Skill | ★ · licence | What it instructs | Rating | Verdict |
|---|---|---|---|---|
| Jakeschincariol/instagram-agent-skill → `ig-carousel` | 5.0k · MIT | 6–10 slides, cover ≤ 6 words, ≤ 25 words a slide, type ≥ 32 px at 1080, cover text 120 px inside the edges, alt text | 4 | **ADAPT** into the §07 rules and prompts |
| Siyana158/dev-craft → `indic-typography` | 0 · MIT | `lang` tags, script font after the Latin one, line-height 1.65–1.85, no negative letter-spacing, no uppercase/italic, "write shorter headlines, don't shrink" | 4 | **ADAPT** into our `bangla-typography` (written for Tamil; test the numbers) |
| opuu/bangla-writer | 0 · MIT | Natural Bangladeshi register, spelling, product wording; eval rubric | 4 | **ADAPT** into `bangla-writing` + product prompts/evals |
| affaan-m/ECC → `bengali-nlp` | 298k · MIT | Unicode normalization, conjuncts, Banglish detection | 4 | **ADAPT**: count characters correctly for caption limits |
| jeevanbavandla/instagram-carousel-skill | 11 · MIT | 4 styles (Bold / Tweet / Editorial / Showcase), brand-config.json | 3 | REFERENCE: our looks are similar |
| mehul-fanawala/linkedin-carousel-skill | 11 · **no licence** | "A style is a layout, not just a palette", ≥ 72 px side padding | 3 | REFERENCE only |
| charlie947/social-media-skills → `graphic-designer` | 4.6k · MIT | Check each PNG at full size and at feed width | 2 | REFERENCE |

The studio's own `social-posts` skill (HTML → PNG, EN + Bangla, fit report, "shorten, don't shrink") covers more
than anything external and is the base for `post-design`.

## Accessibility

| Skill | ★ · licence | What it instructs | Rating | Verdict |
|---|---|---|---|---|
| addyosmani/web-quality-skills → `accessibility` | 3.0k · MIT | WCAG 2.2, evidence first: axe → accessibility tree → keyboard; "a score of 100 is not conformance" | 4 | **USE** |
| ibelick/ui-skills → `fixing-accessibility` | 10.7k · MIT | Quotes the offending line plus a fix | 5 | **USE** |
| storybookjs/mcp → `stories` (`test-run`) | 271 · MIT | Runs stories with a11y results | 4 | **USE** if Storybook ≥ 10.5 |
| Community-Access/accessibility-agents → `contrast-master`, `design-system-auditor` | 435 · MIT | Contrast, focus and target size on tokens | 3 | ADAPT: copy 2 files; its installer adds blocking hooks |
| agentic-qe `a11y-ally` | 525 | Depends on a bot-detection-evasion plugin | 1 | SKIP |

## Security

| Skill | ★ · licence | What it instructs | Safety | Rating | Verdict / user |
|---|---|---|---|---|---|
| cloudflare/security-audit-skill | 62k · MIT | Data isolation ("a tenant field is not isolation"; caches, signed links), AI and LLM ("a guardrail prompt is not a boundary"), SSRF with redirects and DNS rebinding | local Node validators | 5 | **USE** (Cerberus, guidance mode) |
| openai/skills → `.curated/security-best-practices` | 28.5k · Apache-2.0 (per skill) | Next.js 16: Server Actions are public endpoints, middleware matcher gaps, cache leaks, uploads, SSRF, CSRF, sessions | none | 5 | **USE** (builder; Next.js + React refs) |
| agamm/claude-code-owasp | 429 · MIT | OWASP Top 10:2025, ASVS 5.0, LLM 2026, Agentic ASI01–10; four reachability questions before reporting | none | 4 | **USE** (builder, Cerberus report format) |
| anthropics/claude-plugins-official → `security-guidance` | 46k · Apache-2.0 | Warnings on risky edits; Opus review at Stop; agentic review at commit/push (IDOR, auth bypass, SSRF); reads `.claude/claude-security-guidance.md` | Python hooks; extra Opus usage | 4 | **USE** with `ENABLE_STOP_REVIEW=0` |
| Claude Code built-in `/security-review` (= anthropics/claude-code-security-review command) | 6.8k · MIT | Diff-only, > 80% confidence; excludes DoS/rate limits and says user content in AI prompts is not a vulnerability | none | 3 | **ADAPT**: fork for Cerberus without those exclusions |
| anthropics/claude-code-security-review (Action) | 6.8k · MIT | Same prompt + hard filter; custom instruction files | installs at runtime; "not hardened against prompt injection" | 3 | **ADAPT**: pinned SHA, our instructions, same-repo PRs |
| trailofbits/skills → `differential-review` | 8.0k · CC-BY-SA-4.0 | Risk triage, blame removed security code, blast radius, attacker model | none | 4 | **ADAPT** for web (Cerberus) |
| trailofbits/skills → `agentic-actions-auditor` | CC-BY-SA-4.0 | Attack vectors into claude-code-action prompts, `pull_request_target`, eval of AI output | read-only + `gh api` | 5 | **USE** on `.github/**` PRs |
| trailofbits/skills → `insecure-defaults` | CC-BY-SA-4.0 | Fallback secrets, fail-open settings, `CORS *`, with refutation passes | Workflow script; costly | 4 | **USE** weekly |
| trailofbits/skills → `semgrep-rule-creator` | CC-BY-SA-4.0 | Write Semgrep rules test-first | WebFetch | 4 | **USE** for our rules |
| trailofbits/skills → `supply-chain-risk-auditor`, `sharp-edges`, `fp-check` | CC-BY-SA-4.0 | Doesn't read pnpm lockfiles; fp-check adds global hooks | — | 2 | REFERENCE / SKIP |
| getsentry/skills → `security-review`, `gha-security-review`, `skill-scanner` | 1.1k · Apache-2.0 | High-confidence findings; GHA review needs an exploit proof (assumes external attackers only); scans skills for injection | `uv` Python | 3–4 | REFERENCE / ADAPT (add the prompt-injected-agent case) / **USE** `skill-scanner` |
| NVIDIA/SkillSpector | 24.6k · Apache-2.0 | Scans skills for injection, exfiltration, malicious patterns | Python | 4 | **USE** in CI on `.claude/**` |
| zizmorcore/zizmor-action | 176 · MIT | Static audit of GitHub workflows | composite action | 5 | **USE** in CI |
| better-auth/skills → `security`, `organization` | 229 · **no licence** | Secrets, rate limits per endpoint, trusted origins, cookies, encrypted OAuth tokens, org roles | text | 4 | **USE via plugin** (not copied) |
| semgrep official plugin (`semgrep/guardian`) | 19 · no licence | Hooks + closed-source binaries; needs a login | — | 2 | SKIP: Semgrep CLI in CI instead |
| semgrep/skills `code-security`, `llm-security` | Semgrep Rules License | Weak SSRF advice; regex prompt-injection blocklists | — | 2 | REFERENCE |
| anthropics `claude-security` plugin | proprietary | Deep scan with verifiers, SARIF | telemetry; push hooks | 3 | REFERENCE (can't vendor) |
| OWASP Cheat Sheet Series | CC-BY-SA-4.0 | Multi-tenant, SSRF, LLM prompt injection, AI agents, file upload, Next.js, npm, GHA | docs | 4 | REFERENCE: source for our own skills |

## Engineering

| Skill | ★ · licence | What it instructs | Rating | Verdict / user |
|---|---|---|---|---|
| obra/superpowers → `test-driven-development` | 313k · MIT | No production code before a failing test; smallest change to pass; avoid mocks | 5 | **ADAPT** (`pnpm vitest run`; escalate to Athena) · copy, **never the plugin** (its startup hook injects instructions) |
| superpowers → `verification-before-completion`, `systematic-debugging` | MIT | No "done" claim without fresh output; root cause before any fix | 5 | **USE** (gate on `pnpm check`) |
| superpowers → reviewer and receiving-review templates | MIT | Read-only reviewer against the plan; receiver checks each comment | 4 | **ADAPT** into Argus / Daedalus |
| mattpocock/skills → `engineering/tdd`, `code-review` | 316k · MIT | Test public interfaces; bans tautological tests; two-pass review | 4 | **ADAPT**: merge anti-patterns into our TDD skill |
| nizos/probity | 244 · MIT | Hooks block writes until a failing test was seen | 4 | Trial in H0 (zeus-only dev dependency) |
| microsoft/playwright → `playwright-trace`, `playwright-cli` | 99k · Apache-2.0 | Read traces from the CLI; drive a browser | 4 | **USE** |
| Playwright agents (planner, generator, healer) | Apache-2.0 | The healer marks stuck tests `test.fixme()` | 3 | ADAPT: remove the fixme fallback |
| testdino-hq/playwright-skill | 411 · MIT | 79 guides for Playwright 1.64: visual regression, Next.js, flakes, sharding | 4 | **USE** |
| antfu/skills → `vitest`, `pnpm` | 6.0k · MIT | Vitest config/mocking/coverage; pnpm catalogs, `allowBuilds`, frozen lockfile | 4 | **USE** |
| anthropics/skills → `webapp-testing` | Apache-2.0 | Python Playwright waiting on `networkidle` | 1 | SKIP |
| addyosmani/web-quality-skills → `performance`, `core-web-vitals` | 3.0k · MIT | Measure before editing; JS budget under 300 KB; "findings without measurement are hypotheses" | 4 | **USE** + Lighthouse CI |
| vercel/next.js → `next-bundle-optimizer`, `next-dev-loop` + bundled docs / `AGENTS.md` | 143k · MIT | Audit-only bundle work; dev loop through `/_next/mcp` (Next 16.3+) | 4 | **USE** / ADAPT |
| ChromeDevTools/chrome-devtools-mcp → `memory-leak-debugging`, `debug-optimize-lcp` | 55k · Apache-2.0 | Heap snapshots (for the Chrome worker); LCP breakdown | 4 | ADAPT: `--no-usage-statistics --no-performance-crux` |
| claude-plugins-official → `typescript-lsp` | 46k · Apache-2.0 | Type errors and go-to-definition via the language server | 4 | **USE** |
| claude-plugins-official → `pr-review-toolkit` agents | Apache-2.0 | `pr-test-analyzer`, `silent-failure-hunter`, `type-design-analyzer` | 5 | **USE** (Argus) |
| Claude Code built-in `/code-review`, `/simplify` | built in | Effort-level reviews; cleanup before handoff | 5 | **USE** |
| claude-plugins-official → `code-simplifier` | Apache-2.0 | Hard-codes Anthropic's style | 2 | SKIP (use `/simplify`) |
| supabase/agent-skills → `supabase-postgres-best-practices` | 3.0k · MIT | ~32 Postgres rules: FK indexes, partial/covering indexes, pooling, short transactions, SKIP LOCKED, cursor pagination | 5 | **USE** (any Postgres) |
| drizzle-orm beta → `drizzle-kit/skills/drizzle` | 36k · Apache-2.0 | generate vs push, rename hints, data-loss confirmation | 4 | REFERENCE: needs drizzle-kit 1.0-rc; use `orm.drizzle.team/llms-full.txt` |
| sbdchd/squawk | 1.3k · Apache-2.0 | Lints migration SQL for locking and unsafe changes | — | **USE** in CI |
| vercel/turborepo → `turborepo` | 31k · MIT | Read the bundled turbo docs | 4 | LATER, only if Turborepo is adopted |

## Platform and product

| Skill | ★ · licence | What it instructs | Rating | Verdict |
|---|---|---|---|---|
| docker/skills → `docker-compose-patterns`, `docker-build-strategies`, `docker-destructive-guardrails` | 616 · Apache-2.0 | `compose.yaml`, pinned tags, healthchecks, multi-stage builds; confirm before volume removal or prune | 5 | **USE** |
| github/awesome-copilot → `github-actions-hardening` | 40.9k · MIT | `${{ }}` injection, `pull_request_target`, SHA pinning, least-privilege token, OIDC | 5 | **USE** |
| getsentry/sentry-for-ai → `sentry-instrument`, `setup-releases`, `debug-issue`, `fix-stack-traces`, `create-alert` | 275 · MIT | SDK setup without duplicate inits, source maps, releases, Anthropic SDK monitoring incl. token cost | 5 | **USE** |
| better-auth/skills → `best-practices`, `create-auth`, `organization`, `security` | 229 · **no licence** | Drizzle adapter, magic link + Google, org roles/invites, rate limits, trusted origins | 5 | **USE via plugin**; docs MCP |
| resend/resend-skills → `resend`, `react-email`, `email-best-practices` | 212 · MIT | Idempotency keys, webhook verification, SPF/DKIM/DMARC, CAN-SPAM/GDPR | 5 | **USE** (M4) |
| stripe/ai → `stripe-best-practices`, `upgrade-stripe` | 2.0k · MIT | Checkout + Billing + Portal, webhooks required, restricted keys, sandboxes | 5 | LATER if Stripe: copy the skills, **not the plugin** (it adds a feedback prompt every turn) |
| PaddleHQ/paddle-agent-skills | 9 · Apache-2.0 | Signed webhooks, dedupe on `eventId`, order by `occurredAt`, sandbox first | 5 | LATER if Paddle: copy the skills; sandbox MCP only |
| cloudflare/skills → R2 references | 3.3k · Apache-2.0 | Presigned URLs, CORS, lifecycle, EU jurisdiction | 3 | REFERENCE (+ `developers.cloudflare.com/r2/llms.txt`) |
| anthropics/skills → `claude-api` | 188k · Apache-2.0 | Official SDK, structured outputs, caching; `build-eval`, `cost-optimize`, `prompt-audit` | 5 | **USE** (already in Claude Code) |
| hamelsmu/evals-skills | 1.7k · MIT · **archived** | Error analysis on ~100 traces, judge prompts, checking the judge | 5 | **USE** (pinned copy) |
| promptfoo → `promptfoo-evals` | 26.9k · MIT | Eval suites, asserts, red-team mode | 3 | REFERENCE (later for injection red-teaming) |
| github/awesome-copilot → `gdpr-compliant` | MIT | GDPR Art. 5/25/32/33/35: retention at schema time, data-subject requests, minimal logging | 4 | **ADAPT**: fix broken links; add our sub-processors |
| mukul975/Privacy-Data-Protection-Skills → `gdpr-dpa-art28`, `cnil-cookie-banner` | 332 · Apache-2.0 | Art. 28 DPA clauses, cookie banner | 3 | ADAPT: text only, drop scripts |
| fcakyon/claude-codex-settings → `hetzner-deploy` | 1.2k · Apache-2.0 | hcloud firewalls, snapshots, Storage Box | 3 | LATER (provisioning) |
| danielvm-git/bigpowers → `harden-vps` | 287 · MIT | UFW, fail2ban, unattended upgrades | 3 | REFERENCE: ignores Docker bypassing UFW |
| next-intl agents docs | 4.4k · MIT | No hardcoded strings, ICU messages | 3 | LATER (UI is English-only) |

## Gaps we fill ourselves

Nothing credible exists for these, so we write them (in H0 or the milestone that needs them):

| Our skill | Covers | Built from |
|---|---|---|
| `safe-fetch` | SSRF in the headless-Chrome worker: request interception, redirects, iframes, websockets, `file:`/`chrome:` schemes, DNS rebinding, an outbound-network firewall for the worker container | OWASP SSRF cheat sheet, Cloudflare SSRF guidance |
| `tenant-isolation` | A scoped Drizzle query helper on every query + Postgres row-level security with a per-transaction `set_config` | Cloudflare data-isolation, OWASP multi-tenant |
| `review-links` | Token entropy, tokens hashed at rest, expiry, scope, revoke, rate limits, `Referrer-Policy`, noindex | OWASP |
| `jobs` | pg-boss: tenant context in every job, payloads untrusted, idempotency, bounded retries | — |
| `llm-injection` | The §22 extraction step, untrusted-data wrapping, the injection evals | Cloudflare AI-and-LLM, OWASP LLM |
| `uploads` | Type sniffing, size limits, image re-encoding, storage keys | OWASP file upload |
| `safe-migrations` | Expand → migrate → contract, lock timeouts, non-blocking index builds, squawk | Supabase rules, squawk |
| `chrome-worker` | Process lifecycle, timeouts, cleanup | the studio's `render.mjs` |
| `visual-determinism` | Pinned Docker image and fonts for screenshot tests | testdino guides |
| `ai-cost-caps` | Per-workspace budgets and the global daily cap | §22 |
| `vps-and-backups` | Docker ports bypassing UFW, Caddy, pg_dump → R2 with encryption, retention, restore drill | docker skills |
| `design-system` | Tokens, components, patterns, voice; how to add a component | `DESIGN.md`, §05 |
| `post-design` | Post layouts and looks in a brand's style | studio `social-posts`, ig-carousel |
| `bangla-typography` | Bangla web typography with tested numbers | indic-typography, W3C drafts, our renders |
| `bangla-writing` | Native Bangladeshi Bangla for product prompts and evals | bangla-writer, studio `scriptwriting` |

Also no credible skill for: Caddy (no llms.txt), Hetzner (no official MCP), pg-boss (no docs for agents), Lighthouse CI,
TypeScript strict-mode conventions, mockup-vs-screenshot comparison, text fit on fixed canvases, legal documents (a
lawyer is still needed for the privacy policy and DPA).
