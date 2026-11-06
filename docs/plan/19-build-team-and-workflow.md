# Section 19: Build team and workflow (Approved 2026-11-06, revised 2026-11-06 and 2026-11-07)

> **Stack:** decided in [§13](13-architecture.md) (approved 2026-11-06). Where this doc differs, §13 wins.

**Goal:** who builds LetZeusPost, how a task goes from an approved section to merged code, and how Zeus stays in control.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| Where do the building agents run? | Locally in Claude Code on Zeus's Mac (git worktrees); an independent Claude review comments on GitHub |
| Who merges? | **Zeus merges every PR.** (First answer was "agents merge, Zeus audits". Revised the same day: on GitHub Free a private repo can't have merge rules or auto-merge, and Zeus chose to stay on Free.) **2026-11-07:** Zeus handed merging to Athena, through the [merge gate](#the-merge-gate): "You can merge any PR … make sure the harness and safety are maintained properly." Builders still never merge. |
| Team shape? | One builder + independent reviewers. H0 starts with the builder, Argus and Cerberus; Iris joins with the first UI work |
| How many builders at once? | 1 in H0; up to 3 later, if Zeus's Claude usage limits allow |
| Which GitHub identity? | Zeus's account, through a **repo-only token** (see [20](20-builder-guardrails.md)); a bot account was tried and suspended |
| Outside skills? | A small core set; more only when needed (below) |

## Spec

### The team (agent files in `.claude/agents/`)

| Agent | Role | Tools | Model |
|---|---|---|---|
| **Athena** (main session, Zeus's own login) | Lead: turns approved sections into build tasks, dispatches builders, runs the local reviews, merges through the merge gate, moves board cards, writes the weekly report | all | Opus 5.5 |
| **Daedalus** `daedalus-builder` | Builds one task end to end in its own worktree (`isolation: worktree`) | Read, Edit, Write, Bash, Grep, Glob; no Agent | Opus 5.5, effort xhigh |
| **Argus** `argus-reviewer` | Code review: correctness, tests, plan conformance, simplicity | Read, Grep, Glob, Bash (read-only commands); no Edit/Write/Agent | Opus 5.5, effort high |
| **Cerberus** `cerberus-security` | Security review, **only** when a diff touches a sensitive area: auth, tokens, uploads, website fetch (SSRF), workspace isolation, AI prompts, dependencies, workflows | same as Argus | Opus 5.5, effort high |
| **Iris** `iris-design` | Design review (joins at the first UI milestone): PR screenshots vs approved mockups, tokens, accessibility, interface voice | same as Argus | Opus 5.5, effort high |
| **GitHub review** | A second, independent review that comments on every PR (claude-code-action + the code-review plugin). Not a gate on its own: the merge gate needs each of its findings fixed or answered | comments only | Zeus's subscription token |

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
7. **Merge gate.** Athena runs `scripts/merge-gate.mjs <pr>`. It checks every item in [the merge gate](#the-merge-gate)
   and only then squash-merges. **Builders never merge.**
8. **Done.** The board's built-in workflow moves the card to Done when the issue closes; Athena removes the worktree.
9. **Failures.** A red check gets up to 3 fix attempts; after that, `blocked` plus a comment saying what's wrong.

### The merge gate

Zeus handed merging to Athena on 2026-11-07, on one condition: the harness and safety stay intact. Athena merges only
through `scripts/merge-gate.mjs <pr>`, which checks each item with `gh` and refuses the merge if any fails. Builders
can't merge at all (deny rules, hooks and the red-team list in [20](20-builder-guardrails.md) still block it).

A PR merges only when all of these hold:

1. **Not frozen:** the repo variable `AGENTS_PAUSED` isn't `true`.
2. **Linked and current:** the PR closes a `build-task` issue (or is a plan/docs PR Zeus asked for), isn't a draft,
   and its branch is up to date with `main`.
3. **Checks green:** every check on the head commit passed (the CI job `ci` and `risk-gate`); none failed, pending or
   skipped. Before CI exists (#24), the PR shows fresh `pnpm check` output.
4. **Tier set:** exactly one of `sensitive` / `routine`, from the risk gate (from #26 on).
5. **Reviewed from a fresh context:** Argus found nothing blocking; Cerberus too when the PR is `sensitive`; Iris
   when it touches UI (from the first UI milestone). Athena's own PRs (harness, docs) get the same reviews. The
   verdicts are recorded for the PR's head commit in Athena's local review record, which sits outside every worktree,
   so a sandboxed builder can't write it; a new push needs new reviews. Each verdict is also posted on the PR.
6. **GitHub review answered:** the AI review (from #27) has run on the head commit, and each finding is fixed or
   answered in a reply.
7. **Done-when proven:** every box in the PR's Done-when list is ticked, with evidence.
8. **Harness changes re-tested:** when the PR touches `.github/`, `.claude/`, a `CLAUDE.md`, the sensitive-paths
   list, the hooks or the merge gate itself, the red-team items it affects are run again and the results are in the PR.

Never: `--admin`, merging with a red or pending check, merge commits or rebase merges (squash only), pushing to `main`,
force pushes.

**Zeus keeps control:** the freeze switch (`AGENTS_PAUSED`), reverting any merge, and the weekly report, which lists
every merge with its tier and reviews. He can take merging back at any time.

### Weekly report (Fridays)

Athena opens **"Week 2026-Wnn"** (label `audit`): every merge with its tier, reviews and merge-gate result,
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
| Daedalus | `conventions`: stack, folders, commands, patterns (written from §13) | ours |
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

Builders merging any PR · builders running in the cloud · more
than 3 builders · a specialist team with a lead agent splitting work.

## Done when

- The agent files, PR and issue templates, `pnpm check` and the dispatch steps exist (milestone H0).
- A dry-run task goes from Ready to a PR that passes the merge gate and is merged, with every H0 check exercised.
- The first weekly report is produced.

## Depends on

[01](01-product-spec.md), [13](13-architecture.md), [20](20-builder-guardrails.md), [21](21-ai-design-workflow.md).
