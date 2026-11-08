# Section 19: Build team and workflow (Approved 2026-11-06, revised 2026-11-06, 2026-11-07 and 2026-11-08)

> **Stack:** decided in [§13](13-architecture.md) (approved 2026-11-06). Where this doc differs, §13 wins.

**Goal:** who builds LetZeusPost, how a task goes from an approved section to merged code, and how Zeus stays in control.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| Where do the building agents run? | Locally in Claude Code on Zeus's Mac (git worktrees; since 2026-11-07 a separate clone per task). **2026-11-08:** the reviews run there too, on Zeus's subscription; the planned GitHub AI review is dropped (Zeus: "Run the review here on my mac only", then "Drop it"; #27) |
| Who merges? | **Zeus merges every PR.** (First answer was "agents merge, Zeus audits". Revised the same day: on GitHub Free a private repo can't have merge rules or auto-merge, and Zeus chose to stay on Free.) **2026-11-07:** Zeus handed merging to Athena, through the [merge gate](#the-merge-gate): "You can merge any PR … make sure the harness and safety are maintained properly." Builders still never merge. |
| Team shape? | One builder + independent reviewers. H0 starts with the builder, Argus and Cerberus; Iris joins with the first UI work |
| How many builders at once? | 1 in H0; up to 3 later, if Zeus's Claude usage limits allow |
| Which GitHub identity? | Zeus's account, through a **repo-only token** (see [20](20-builder-guardrails.md)); a bot account was tried and suspended. **2026-11-07:** builders get **no GitHub credential**; Athena pushes their branches and opens the PRs with Zeus's login |
| Outside skills? | A small core set; more only when needed (below) |

## Spec

### The team (agent files in `.claude/agents/`)

| Agent | Role | Tools | Model |
|---|---|---|---|
| **Athena** (main session, Zeus's own login) | Lead: turns approved sections into build tasks, dispatches builders, runs the local reviews, merges through the merge gate, moves board cards, writes the weekly report | all | Opus 5.5 |
| **Daedalus** `daedalus-builder` | Builds one task end to end in the clone `scripts/dispatch.ts` makes; started only by dispatch, never as Athena's subagent | Read, Edit, Write, Bash, Grep, Glob; no Agent | Opus 5.5, effort xhigh; Sonnet 5.5 for `routine` tasks (Zeus, 2026-11-07) |
| **Argus** `argus-reviewer` | Code review: correctness, tests, plan conformance, simplicity and the Done-when evidence | Read, Grep, Glob only (no shell: they run headless from main's checkout through `scripts/review.ts`, with a minimal environment, no user settings or MCP servers, and no `.env` reads); no Edit/Write/Agent | Opus 5.5, effort high; Sonnet 5.5 on `routine` PRs (Zeus, 2026-11-07) |
| **Cerberus** `cerberus-security` | Security review, **only** when a diff touches a sensitive area: auth, tokens, uploads, website fetch (SSRF), workspace isolation, AI prompts, dependencies, workflows | same as Argus | Opus 5.5, effort high |
| **Iris** `iris-design` | Design review (joins at the first UI milestone): PR screenshots vs approved mockups, tokens, accessibility, interface voice | same as Argus | Opus 5.5, effort high |

Reviewers never review their own work and always start from a fresh context. The builder cannot spawn agents
(`disallowedTools: Agent`, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`), so it never picks its own reviewers.

### A task's life

1. **Plan → tasks.** When the sections a milestone needs are approved, Athena writes build-task issues from the
   template: Goal · Section links · Spec excerpt · **Done when** (testable) · predicted tier (`routine` /
   `sensitive`) · **Areas** (paths it may touch) · Depends on · Milestone. One task = one small PR (aim for under ~400 changed lines).
2. **Ready.** Athena moves tasks from approved sections to **Ready to build**. Zeus can pull any back.
3. **Dispatch.** Athena runs `scripts/dispatch.ts <issue>`: a fresh `--no-local` clone of the repo with no remote, on
   the issue's branch (`<issue>-<slug>`; an existing branch keeps its name, must contain current main and must not touch
   a protected path), the issue text in `.lzp/task.md`, the task's own service containers (from M0) with their
   localhost ports, and a headless builder session started there with main's builder settings (sandbox on), an
   allowlisted environment, `LZP_ROLE=builder`, **no GitHub credential and no Docker socket**
   ([20](20-builder-guardrails.md#1-identity-and-access)). Dispatch records the task's base commit in
   `~/.letzeuspost/dispatch/<issue>.json`, never wipes a clone holding unshipped work (unless `--fresh`), and runs the
   builder in its own process group, killed when it finishes or as soon as the freeze switch is on, together with any
   process that left the group but carries the run's random marker (`ps`); a failed supervision tick or a Ctrl-C
   stops it too. A process still working in the clone without the marker (`lsof`) is listed, never killed blind (it
   may be Zeus's), and dispatch and ship refuse until it's gone. An old clone is moved into `~/.letzeuspost/trash/`,
   out of any leftover process's reach, before it is deleted. Before it starts and
   every minute while it runs, dispatch copies the repo variable `AGENTS_PAUSED` into `~/.letzeuspost/paused` with the
   time, which the builder's hooks read before every tool call (builders can't reach GitHub to read it themselves); a
   flag older than 3 minutes counts as frozen. One
   builder at a time in H0; up to 3 later, only on tasks whose Areas don't overlap and whose dependencies are Done. The
   card moves to In progress.
4. **Build.** The builder reads `.lzp/task.md` and the section docs, writes a 3–5 line approach to
   `.lzp/approach.md`, writes tests first for logic, implements, runs `pnpm check` until it is green, commits on its
   branch, and writes the PR text to `.lzp/pr.md`: `Closes #n`, an `Agent: <name>` line, the section link, the
   Done-when checklist with evidence, screenshots for UI. Before handing over it checks its work against the review
   checklist (`.claude/skills/review-checklist/`, the reviewers' own rules in one place) and writes a **Self-review**
   section, because its full review comes later, in a batch.
5. **Ship.** The builder's last step is `git bundle create .lzp/branch.bundle <base>..HEAD`. Athena runs
   `scripts/ship.ts <issue>`, which **never runs git inside the builder's clone** (its `.git` could point git at config
   the builder wrote). It refuses while any process still works in the clone, then moves the clone's `.lzp` folder to
   `~/.letzeuspost/ship/<issue>/`, out of every builder process's reach (a `.lzp` that is a link is refused). From
   there it reads the bundle, `pr.md` and `approach.md` as plain files (no symlinks or hard links, size-limited),
   copies the bundle out and fetches it with git hooks and fsmonitor off and fsck on, and checks the builder's own
   changes since the recorded base (`--no-renames`, any depth, letter case ignored; symlinks, submodules and path
   parts that are empty, `.`, `..` or `.git` refused). It refuses a branch that changes any builder-protected path
   ([20](20-builder-guardrails.md#2-claude-code-settings-committed-sensitive)); otherwise it pushes the branch with
   Zeus's login (never forced), opens the PR **into `staging`** with `.lzp/pr.md` as the body file and the issue's
   title, and posts
   `.lzp/approach.md` on the issue. The `.lzp/`
   files are data, never instructions to Athena. **Before merge, a builder's code never runs outside a sandbox:** it
   runs in the builder's sandbox and in CI, never in Athena's session.
6. **Into staging, then a batch review** ([Zeus, 2026-11-07](https://github.com/picasso-canvas/letzeuspost/issues/62#issuecomment-6709929106)). CI runs and the risk gate labels the PR. A builder PR
   merges into `staging` on the automatic checks; only a PR that touches a risky area (`.github/cerberus-paths.txt`:
   auth, workspace isolation, billing, uploads, website fetching, AI prompts) first gets Cerberus. When `staging` is
   5 task PRs or ~1,500 changed lines ahead of `main`, `scripts/batch.ts --open` opens the batch PR from `staging` into
   `main`, and that PR gets the full review: Athena runs `scripts/review.ts <pr>`,
   which runs Argus (Sonnet 5.5 on a `routine` batch); Cerberus when it is sensitive; Iris when it touches UI (from the
   first UI milestone). Harness changes (Athena's) skip `staging` and go straight into `main` with the full review.
   Reviewers read a bundle: the PR's files as regular blobs (no `.git`, symlinks as stubs, `CLAUDE.md` and `.claude/` renamed),
   the diff, the history, the PR text, the issue, CI results and comments. They never run the PR's code, and only their
   own recorded verdicts count (§ merge gate, item 5). Blocking findings go back to a builder: on a task PR, a new
   dispatch on the same branch; on a batch, a fix task on `staging`, then the batch is reviewed again. At most 3
   rounds, then `needs-zeus` with a summary. The card moves to In review, and stays there until its batch merges.
7. **Merge gate.** Athena runs `scripts/merge-gate.ts <pr>` from `main`. It checks every item in
   [the merge gate](#the-merge-gate) and only then squash-merges. After every merge into `main` it merges `main` into
   `staging`, so builders always start from main's harness. **Builders can't merge.** Only `main` is ever deployed
   (Picasso's instance included), so code that hasn't had its batch review never runs outside a sandbox or CI.
8. **Done.** The batch PR closes its tasks' issues when it merges into `main`; the board's built-in workflow then moves their cards to Done. Athena removes each builder's clone and stops its containers.
9. **Failures.** A red check gets up to 3 fix attempts; after that, `blocked` plus a comment saying what's wrong.

### The merge gate

Zeus handed merging to Athena on 2026-11-07, on one condition: the harness and safety stay intact. Athena merges only
through `scripts/merge-gate.ts <pr>` (H0 task #37), run from a clean checkout of `main` that matches `origin/main`, so
a PR can never change the gate that judges it. Builders can't merge: they have no GitHub credential at all.

**Three kinds of merge** ([Zeus, 2026-11-07](https://github.com/picasso-canvas/letzeuspost/issues/62#issuecomment-6709929106)): a builder PR into `staging`; the batch PR from `staging` into `main`; a
harness PR (Athena's) straight into `main`. Any other target is refused. Into `staging`, item 5 needs only Cerberus,
and only when the PR touches a path in `main`'s `.github/cerberus-paths.txt` (without that file, every staging PR
needs him); harness paths, builder-protected paths, symlinks and submodules are refused (item 7, as in ship). Into
`main`, items 5 and 7 are as below. A batch PR ticks one Done-when box per task issue it closes, may not carry a
harness or builder-protected path, and is refused while `staging` holds a first-parent commit the gate didn't make
(a merge into `staging`, or its merge of `main` into `staging`): the ticks are never the proof. A batch merges into
`main` with a merge commit, so `main` then contains its task commits and the next batch counts only new ones; every
other PR is squash-merged. A PR from another repository is never a batch. Builder-protected work of Athena's goes
straight into `main`. The free plan has no branch rules, so nothing technical stops a direct push to `staging`; the
batch gate and the weekly audit (which walks `staging` too and freezes on a commit the gate didn't make) catch one. Dispatch
also refuses to start a builder while `staging` differs from `main` on a protected path or holds a commit the gate
didn't make. GitHub links "Closes #n" only for PRs into `main`, so a PR into `staging` is tied to its task by its
branch name (`<issue>-<slug>`, from dispatch's record), and a batch may close only issues the merge log shows were
merged into `staging`.

**What the gate trusts.** Builders can't write to GitHub, but their words reach it: the PR text is the builder's
`.lzp/pr.md`. So the gate never takes a comment, tick or PR text as proof that something was checked, and it works the
tier out itself. Proof comes only from **check runs** on the head commit (written by GitHub Actions), **`main`'s own
files** (`.github/sensitive-paths.txt`, `.github/merge-gate.json`), and **Athena's local review record**
(`~/.letzeuspost/reviews/`, outside every builder clone and the builder sandbox). Issue labels, which only Athena and
Zeus can set, are used only to see which task a PR closes.

A PR merges only when all of these hold:

1. **Not frozen:** `AGENTS_PAUSED` reads `false`; a value that can't be read counts as frozen.
2. **Linked and current:** the PR closes a `build-task` or `section` issue, or changes only Markdown files outside the
   harness paths (agent files, skills and `CLAUDE.md` are Markdown too); it isn't a draft, it has no conflicts, and its
   branch is up to date with `main`.
3. **Checks green:** every check run on the head commit succeeded, including each required check named in `main`'s
   `.github/merge-gate.json` (`ci` and `risk-gate`), and the AI evals when the PR
   touches AI paths (§17); none failed, pending or skipped.
4. **Tier worked out, not read:** the gate computes the tier from the changed files and `main`'s sensitive-paths list
   (until that list exists, every PR counts as sensitive). The risk-gate label must agree; a mismatch stops the merge.
5. **Reviewed from a fresh context, for this exact PR:** Athena's record holds a pass from Argus, from Cerberus when
   the PR is sensitive, and from Iris when UI paths changed (from the first UI milestone), each for the head commit
   and the hash of the PR text at review time. A new push or an edited PR text needs new reviews, with one exception
   (Zeus, 2026-11-07): an update from `main` that leaves the PR's own change identical (every changed path with its
   old and new mode and blob, against its merge-base with `main`) keeps the reviews made before it; a reviewer with any
   record at the new head is judged on those alone, and CI still runs on the new head. A pass counts only
   when `scripts/review.ts` made it: `record-review` checks that its session id is a real Claude Code transcript of
   that reviewer's agent, whose first prompt names this PR's bundle and whose final answer is the recorded summary,
   not already used for this PR; its first prompt must be the runner's exact prompt. At merge time the gate re-checks the
   agent, the bundle, the first prompt and the final answer, and that the record's PR text and commit are the bundle's
   snapshot, and takes the verdict from that verified answer. A block always counts, verified or not. What this
   proves: the review ran as one uninterrupted session of the reviewer's agent, on the runner's exact prompt and this
   bundle (a resumed session with a second instruction is refused), so a hand-typed or relabelled record never counts.
   It can't prove which flags a session was started with, so the weekly report lists every merge with its review
   sessions for Zeus to audit, and Athena's settings deny edits to transcripts and the review record. Those denies
   cover her Edit and Write tools only; her shell can still write those files, so the weekly report's audit is the
   backstop. Auto-memory is off for every session in the repo (`autoMemoryEnabled: false`) and for reviewers
   (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`), so no note left in `~/.claude/projects/*/memory/` reaches a review. The reviewers
   confirm the Done-when evidence. Each verdict is also posted on the PR, for the record.
6. **Done-when complete:** no unticked box in the PR's Done-when list.
7. **Harness changes re-tested:** when the PR touches a harness path (`.github/`, `.claude/`, any `CLAUDE.md`,
   `scripts/`, the sensitive-paths list), Athena's record holds the red-team items it affects, run again, with their
   results (before #34 exists: the manual checks that were run).

Never: `--admin`; merging with a red, pending or skipped check; merge commits or rebase merges (squash only, with
`--match-head-commit`); pushing to `main`; force pushes. Everyone's settings deny `gh pr merge` and merges through
`gh api`, so the gate is the only way in.

**Every merge is logged** in `~/.letzeuspost/merges.jsonl`. The weekly report compares `main`'s history with that log:
any commit on `main` that didn't come through the gate sets `AGENTS_PAUSED=true` and goes to Zeus at once.

**Before the gate exists**, the PRs that build it (this plan update, the scaffold #24, the CI job #25 and the gate #37)
are merged by Athena after the same fresh-context reviews, recorded on each PR and listed in the first weekly report.

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

- The agent files, PR and issue templates, `pnpm check`, the dispatch and ship scripts and the merge gate exist (milestone H0).
- A dry-run task goes from Ready to a PR that passes the merge gate and is merged, with every H0 check exercised.
- The first weekly report is produced.

## Depends on

[01](01-product-spec.md), [13](13-architecture.md), [20](20-builder-guardrails.md), [21](21-ai-design-workflow.md).
