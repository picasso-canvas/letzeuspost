# Section 19: Build team and workflow (Approved 2026-11-06)

**Goal:** who builds LetZeusPost, how a task goes from an approved section to merged code, and how Zeus stays in
control while agents merge their own work.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| Where do the building agents run? | Locally in Claude Code on Zeus's Mac (git worktrees); an independent Claude review runs on GitHub |
| How much do agents merge on their own? | **Agents merge** when every gate passes; **Zeus audits weekly** |
| Team shape? | One builder + independent reviewers (code, security, design) |
| How many builders at once? | 2–3, each in its own worktree |
| How does the weekly audit reach Zeus? | A weekly issue on the board every Friday |
| Which outside skills may be used? | MIT/Apache, plus CC-BY-SA text with attribution; repos without a licence are never copied (see [20](20-builder-guardrails.md)) |

## Spec

### The team (agent files in `.claude/agents/`)

| Agent | Role | Tools | Model |
|---|---|---|---|
| **Athena** (main session) | Lead: turns approved sections into build tasks, dispatches builders, runs the local reviews, writes the weekly audit | all | Opus 5.5 |
| **Daedalus** `daedalus-builder` | Builds one task end to end in its own worktree (`isolation: worktree`) | Read, Edit, Write, Bash, Grep, Glob; no Agent | Opus 5.5, effort xhigh |
| **Argus** `argus-reviewer` | Code review: correctness, tests, plan conformance, simplicity | Read, Grep, Glob, Bash (read-only commands); no Edit/Write/Agent | Opus 5.5, effort high |
| **Cerberus** `cerberus-security` | Security review on risky areas: auth, tokens, uploads, website fetch (SSRF), workspace isolation, AI prompts, dependencies, workflows | same as Argus | Opus 5.5, effort high |
| **Iris** `iris-design` | Design review: PR screenshots vs approved mockups, tokens, accessibility, interface voice | same as Argus | Opus 5.5, effort high |
| **GitHub review** | A second, independent review on every PR (claude-code-action + the code-review plugin) | comments only | Zeus's subscription token |

Reviewers never review their own work and always start from a fresh context. The builder cannot spawn agents
(`disallowedTools: Agent`, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`), so it never picks its own reviewers.

### A task's life

1. **Plan → tasks.** When the sections a milestone needs are approved, Athena writes build-task issues from the
   template: Goal · Section links · Spec excerpt · **Done when** (testable) · predicted **risk tier** (auto /
   zeus-only) · **Areas** (paths it may touch) · Depends on · Milestone. One task = one small PR (aim for under ~400 changed lines).
2. **Ready.** Athena moves tasks from approved sections to **Ready to build**. Zeus can pull any of them back.
3. **Dispatch.** Athena runs **up to 3 builders** at once (`claude --worktree <issue>`), only on tasks whose Areas
   don't overlap and whose dependencies are Done.
4. **Build.** Status → In progress. The builder reads the issue and its section docs, posts a 3–5 line approach
   comment, writes tests first for logic, implements, and runs `pnpm check` (the same gates as CI) until it is green.
5. **Local review.** Athena runs Argus; Cerberus when the diff touches a risky area; Iris when it touches UI. Blocking
   findings go back to the builder. At most 3 rounds, then `needs-zeus` with a summary.
6. **PR.** The bot opens the PR (`Closes #n`, the Done-when checklist with evidence, screenshots for UI) and turns on
   auto-merge (`gh pr merge --auto --squash`). Status → In review.
7. **GitHub gates** ([20](20-builder-guardrails.md)): `ci`, `ai-review`, `risk-gate`, `guardrail-integrity`. An
   **auto**-tier PR merges itself when all are green. A **zeus-only**-tier PR waits for Zeus's code-owner approval.
8. **Done.** The merge closes the issue (Status → Done), and the worktree is removed.
9. **Failures.** A red check gets up to 3 fix attempts; after that, `blocked` plus a comment saying what's wrong.

### Weekly audit (every Friday)

Athena opens the issue **"Audit 2026-Wnn"** (label `audit`), assigned to Zeus: PRs merged (tier, findings,
reviewers), zeus-only PRs waiting, visual baseline changes with before/after images, tests and coverage trend,
flaky tests, guardrail hits (blocked commands and edits), build AI usage, product eval results, and a list of
suggested reverts. Zeus comments or ticks items. A revert goes in as a revert PR.

### Conventions

Branch `<issue>-<slug>` · Conventional Commits · a PR template and an issue template for build tasks · a
`CLAUDE.md` in each package with its conventions.

### Skills per agent

The full research (about 100 candidates, rated, licences checked) is in [research/skills.md](research/skills.md).
Outside skills are vendored as pinned copies under the rules in [20](20-builder-guardrails.md#outside-skills).

| Agent | Skills |
|---|---|
| **Daedalus** (builder) | Design: our `design-system` (from `DESIGN.md`) · shadcn · baseline-ui · frontend-design (adapted) · make-interfaces-feel-better · emil-design-eng (adapted). Security: OpenAI `security-best-practices` (Next.js + React references) · `claude-code-owasp` · Anthropic `security-guidance` plugin (per-turn review off) with our `.claude/claude-security-guidance.md`. Testing: superpowers `test-driven-development` (adapted), `verification-before-completion`, `systematic-debugging` (copied, never the plugin) · testdino `playwright-skill` · `playwright-trace` · antfu `vitest`. Stack: Next's bundled docs + `AGENTS.md` · `next-bundle-optimizer` · `composition-patterns` · Supabase `postgres-best-practices` · Drizzle `llms-full.txt` · docker skills · `github-actions-hardening` · antfu `pnpm` · Sentry skills · Better Auth (plugin) · Resend skills · `claude-api` · evals-skills. Ours: see below |
| **Argus** (code review) | built-in `/code-review` and `/simplify` · `pr-review-toolkit` agents (`pr-test-analyzer`, `silent-failure-hunter`, `type-design-analyzer`) · superpowers reviewer template (adapted) · the React and Postgres rule files as checklists |
| **Cerberus** (security) | Cloudflare `security-audit` (guidance mode) · our fork of `/security-review` (prompt-injection and rate-limit exclusions removed) · Trail of Bits `differential-review` (adapted for web) and `agentic-actions-auditor` (for `.github/**` PRs) · `insecure-defaults` weekly · the security skills we write |
| **Iris** (design) | design-review agent (adapted from OneRedOak) · Web Interface Guidelines (pinned copy) · impeccable audit/critique rubrics · Emil `review-animations` · `playwright-cli` · addyosmani `accessibility` · ibelick `fixing-accessibility` · Storybook `test-run` |

**Skills we write ourselves** (nothing credible exists), in H0 or the milestone that needs them: `safe-fetch` ·
`tenant-isolation` · `review-links` · `jobs` · `llm-injection` · `uploads` · `safe-migrations` · `chrome-worker` ·
`visual-determinism` · `ai-cost-caps` · `vps-and-backups` · `design-system` · `post-design` · `bangla-typography` ·
`bangla-writing` · stack conventions · `ai-pipeline` · `board`. What each covers is listed in
[research/skills.md](research/skills.md#gaps-we-fill-ourselves).

Adding or changing a skill, agent or MCP server is zeus-only.

## Not in the MVP

Agents running in the cloud or on GitHub as builders; more than 3 builders at once; a specialist team with a lead
agent splitting work.

## Done when

- The agent files, PR and issue templates, `pnpm check` and the dispatch steps exist (milestone H0).
- A dry-run task goes from Ready to merged with every gate exercised.
- The first weekly audit issue is produced.

## Depends on

[01](01-product-spec.md), [20](20-builder-guardrails.md), [21](21-ai-design-workflow.md).
