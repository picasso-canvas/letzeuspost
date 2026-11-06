# Section 19: Build team and workflow (Approved 2026-11-06, revised 2026-11-06)

> **Stack details pending §13.** Folder names, libraries and hosting mentioned here are assumptions, collected in
> [13-architecture.md](13-architecture.md). Section 13 decides them, and its answers override this doc.

**Goal:** who builds LetZeusPost, how a task goes from an approved section to merged code, and how Zeus stays in control.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| Where do the building agents run? | Locally in Claude Code on Zeus's Mac (git worktrees); an independent Claude review comments on GitHub |
| Who merges? | **Zeus merges every PR.** (First answer was "agents merge, Zeus audits". Revised the same day: on GitHub Free a private repo can't have merge rules or auto-merge, and Zeus chose to stay on Free.) |
| Team shape? | One builder + independent reviewers. H0 starts with the builder, Argus and Cerberus; Iris joins with the first UI work |
| How many builders at once? | 1 in H0; up to 3 later, if Zeus's Claude usage limits allow |
| Which GitHub identity? | Zeus's account, through a **repo-only token** (see [20](20-builder-guardrails.md)); a bot account was tried and suspended |
| Outside skills? | A small core set; more only when needed (below) |

## Spec

### The team (agent files in `.claude/agents/`)

| Agent | Role | Tools | Model |
|---|---|---|---|
| **Athena** (main session, Zeus's own login) | Lead: turns approved sections into build tasks, dispatches builders, runs the local reviews, moves board cards, writes the weekly report | all | Opus 5.5 |
| **Daedalus** `daedalus-builder` | Builds one task end to end in its own worktree (`isolation: worktree`) | Read, Edit, Write, Bash, Grep, Glob; no Agent | Opus 5.5, effort xhigh |
| **Argus** `argus-reviewer` | Code review: correctness, tests, plan conformance, simplicity | Read, Grep, Glob, Bash (read-only commands); no Edit/Write/Agent | Opus 5.5, effort high |
| **Cerberus** `cerberus-security` | Security review, **only** when a diff touches a sensitive area: auth, tokens, uploads, website fetch (SSRF), workspace isolation, AI prompts, dependencies, workflows | same as Argus | Opus 5.5, effort high |
| **Iris** `iris-design` | Design review (joins at the first UI milestone): PR screenshots vs approved mockups, tokens, accessibility, interface voice | same as Argus | Opus 5.5, effort high |
| **GitHub review** | A second, independent review that comments on every PR (claude-code-action + the code-review plugin). Not a gate: Zeus reads it before merging | comments only | Zeus's subscription token |

Reviewers never review their own work and always start from a fresh context. The builder cannot spawn agents
(`disallowedTools: Agent`, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`), so it never picks its own reviewers.

### A task's life

1. **Plan → tasks.** When the sections a milestone needs are approved, Athena writes build-task issues from the
   template: Goal · Section links · Spec excerpt · **Done when** (testable) · predicted tier (`routine` /
   `sensitive`) · **Areas** (paths it may touch) · Depends on · Milestone. One task = one small PR (aim for under ~400 changed lines).
2. **Ready.** Athena moves tasks from approved sections to **Ready to build**. Zeus can pull any back.
3. **Dispatch.** Athena starts a builder session in its own worktree with the agent token (1 at a time in H0; up to 3
   later, only on tasks whose Areas don't overlap and whose dependencies are Done) and moves the card to In progress.
4. **Build.** The builder reads the issue and its section docs, posts a 3–5 line approach comment, writes tests first
   for logic, implements, and runs `pnpm check` until it is green.
5. **Local review.** Athena runs Argus; Cerberus when the diff touches a sensitive area; Iris when it touches UI (from
   the first UI milestone). Blocking findings go back to the builder. At most 3 rounds, then `needs-zeus` with a summary.
6. **PR.** The builder opens the PR: `Closes #n`, an `Agent: <name>` line, the Done-when checklist with evidence,
   screenshots for UI. CI labels it `routine` or `sensitive` and the GitHub review comments. Athena moves the card to In review.
7. **Zeus merges.** When the checks are green, Zeus reads the summary (a `sensitive` PR carefully) and squash-merges
   it. **Agents never merge.**
8. **Done.** The board's built-in workflow moves the card to Done when the issue closes; Athena removes the worktree.
9. **Failures.** A red check gets up to 3 fix attempts; after that, `blocked` plus a comment saying what's wrong.

### Weekly report (Fridays)

Since Zeus merges everything, this is short. Athena opens **"Week 2026-Wnn"** (label `audit`): what merged,
`sensitive` PRs still waiting, guardrail hits (blocked commands and edits), AI usage against Zeus's limits, flaky
tests and product eval results.

### Conventions

Branch `<issue>-<slug>` · Conventional Commits with a `Co-Authored-By: Claude` line · a PR template and an issue
template for build tasks · a `CLAUDE.md` in each package with its conventions.

### Skills

The research ([research/skills.md](research/skills.md), about 100 candidates) is a **menu, not an install list**. A
skill is added only when a task needs it or a review finds the same problem twice. Adding one follows the rules in
[20](20-builder-guardrails.md#outside-skills).

**Core set for H0 (8):**

| For | Skill | Source |
|---|---|---|
| Daedalus | `conventions`: stack, folders, commands, patterns (written once §13 is approved) | ours |
| Daedalus | `tdd`: failing test first, smallest change, no "done" without fresh `pnpm check` output, test anti-patterns | ours, adapted from superpowers `test-driven-development` + `verification-before-completion` and mattpocock `tdd` |
| Daedalus | `systematic-debugging`: root cause before any fix | superpowers (MIT), copied |
| Daedalus | `security-best-practices` (Next.js + React references only) | OpenAI (Apache-2.0) |
| Daedalus | `claude-api` | built into Claude Code |
| Argus | built-in `/code-review` + `pr-review-toolkit` agents `silent-failure-hunter` and `pr-test-analyzer` | Claude Code / Anthropic (Apache-2.0) |
| Cerberus | `security-audit` (guidance mode) | Cloudflare (MIT) |
| Cerberus | our fork of `/security-review` without its prompt-injection and rate-limit exclusions | Anthropic (MIT), adapted |

**Added when the milestone needs it:** the UI set at the first UI milestone (see [21](21-ai-design-workflow.md));
our own `tenant-isolation` and `safe-migrations` with the first database work; `safe-fetch` with brand extraction;
`jobs`, `uploads`, `review-links`, `llm-injection`, `ai-cost-caps`, `chrome-worker`, `bangla-typography` and
`bangla-writing` with the features they cover; vendor skills (Sentry, Resend, docker, Supabase Postgres rules) when
that service is wired in.

**Not used for now:** plugins that add hooks or install things at runtime (superpowers plugin, Anthropic
`security-guidance`, `claude-security`, the Stripe plugin, the Better Auth plugin: we read Better Auth's docs instead) ·
Emil motion rules · make-interfaces-feel-better · adapted frontend-design · impeccable rubrics · Storybook MCP · the
Probity TDD hook · Trail of Bits scans. Any of them can come back if a real problem shows up.

## Not in the MVP

Agents merging their own PRs (needs GitHub Pro: revisit if Zeus upgrades) · builders running in the cloud · more
than 3 builders · a specialist team with a lead agent splitting work.

## Done when

- The agent files, PR and issue templates, `pnpm check` and the dispatch steps exist (milestone H0).
- A dry-run task goes from Ready to a PR that Zeus merges, with every H0 check exercised.
- The first weekly report is produced.

## Depends on

[01](01-product-spec.md), [13](13-architecture.md), [20](20-builder-guardrails.md), [21](21-ai-design-workflow.md).
