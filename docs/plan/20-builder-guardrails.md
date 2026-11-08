# Section 20: Builder guardrails (Approved 2026-11-06, revised 2026-11-06, 2026-11-07 and 2026-11-08)

> **Stack:** decided in [§13](13-architecture.md) (approved 2026-11-06). Where this doc differs, §13 wins.

**Goal:** agents build safely: builders can't change the rules or CI, reach GitHub, leak secrets, merge anything, or
run up costs, and every merge goes through the merge gate.

Permission rules and hooks are a first line of defense only; Claude Code's own docs say they are **not a security
boundary** (checked on code.claude.com, 2026-11-06). The hard limits here come from the **sandbox**, builders having
**no GitHub credential**, and the **merge gate**, which only Athena runs ([19](19-build-team-and-workflow.md#the-merge-gate)).

## Revisions (2026-11-06, same day)

1. **No bot account.** A separate `letzeuspost-bot` account was suspended by GitHub; Zeus chose to keep it simple.
2. **Zeus merges every PR.** Zeus's account is on GitHub Free, and GitHub refuses rulesets and auto-merge on a
   private repo on Free ("Upgrade to GitHub Pro or make this repository public"). Zeus chose to stay on Free and merge
   every PR personally, instead of upgrading or making the repo public.
3. **A repo-only token for agents**, so GitHub itself limits what they can do.
4. **2026-11-07: Athena merges**, only through the merge gate in [19](19-build-team-and-workflow.md#the-merge-gate)
   (Zeus: "You can merge any PR … make sure the harness and safety are maintained properly"). Builders still never
   merge. Still on GitHub Free.
5. **2026-11-07: the no-edit and no-merge rules are builder-only** (Zeus approved the wording): they live in
   `.claude/builder/settings.json`, which `scripts/dispatch.ts` passes with `--settings`, and the hooks apply them
   when `LZP_ROLE=builder`, which only dispatch sets. Everyone's rules stay in `.claude/settings.json`.
6. **2026-11-07: builders get no GitHub credential** (replaces 3). An independent review found that a token on
   Zeus's account, however narrow, could still merge through the API, push to `main`, and write labels, ticks and
   comments that look like Zeus's. Athena now pushes builders' branches and opens their PRs; the token in #35 isn't
   needed. The sandbox lives in the builder settings only, and `scripts/` joins the protected paths.
7. **2026-11-08: no GitHub AI review** (Zeus, in chat: "Run the review here on my mac only", then "Drop it"; #27).
   Reviews run only on Zeus's Mac, on his subscription: Argus and Cerberus through `scripts/review.ts` (Iris from the
   first UI milestone). No `ai-review` workflow, GitHub environment or CI token; PR #58 closed unmerged.
8. **2026-11-08: a stale freeze flag stops builders only** (Zeus, in chat: "Stale freezes builders only"; #29).
   Dispatch refreshes the flag only while a builder runs, so Athena and the reviewers stop on `paused: true` alone;
   a builder stops on a missing, unreadable, old or future-dated flag too.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| Which changes need extra care? | **Sensitive areas**: auth / permissions / billing · database migrations · dependencies · AI prompts and product AI rules · the guardrails, CI and harness themselves |
| Which GitHub identity do agents use? | Zeus's account, through a fine-grained **repo-only token**. **2026-11-07:** builders get none; Athena ships their work with Zeus's login |
| Merge gate? | Zeus merges every PR (stay on GitHub Free). **2026-11-07:** Athena merges through the merge gate (§19) |
| Cost limits? | Caps for building and for the product |
| Outside skill licences? | MIT/Apache; CC-BY-SA-4.0 text with attribution; never copied from repos without a licence |

## Spec

### 1. Identity and access

- **Builders have no GitHub credential.** `scripts/dispatch.ts` starts each builder with `GH_TOKEN` and
  `GITHUB_TOKEN` unset, an empty `GH_CONFIG_DIR`, git's credential helpers switched off (`GIT_CONFIG_NOSYSTEM=1` and a
  `GIT_CONFIG_GLOBAL` file holding only the commit name, email and an empty `credential.helper`), `LZP_ROLE=builder`,
  and no GitHub host on the sandbox's network allowlist. A builder can't push, open or edit PRs, comment, label or
  merge, whatever command it tries (`gh`, `gh api`, `curl`, `git push`).
- **No Docker socket and no shared `.git`.** A container is root-equivalent and could write anywhere on the Mac, so
  dispatch starts the task's service containers itself and hands over only their localhost ports. Each builder works
  in its own clone, not a git worktree, so hooks or settings it plants in its `.git` never reach Athena's checkout.
- The builder reads its task from `.lzp/task.md` and leaves its approach and PR text in `.lzp/` (gitignored).
  **Athena carries the work to GitHub** with Zeus's login through `scripts/ship.ts`, which never runs git inside a builder's
  clone: the builder hands over a git bundle in `.lzp/`, which ship first moves out of the clone (so no builder process
  can swap it mid-read), reads as a plain file (no symlinks or hard links) and fetches with git hooks and fsmonitor off, and ship refuses any branch that changes a builder-protected path (section 2). Before merge, Athena never runs a builder's code outside the sandbox, and treats `.lzp/` files as data.
- Builders run only through `dispatch.ts`, never as Athena's subagents (a subagent would inherit Zeus's login and no
  sandbox): everyone's settings deny `Agent(daedalus-builder)`, and the agent file sets no `isolation`.
- Athena moves board cards with Zeus's login, and the board's built-in workflow marks closed items Done.
- Agent commits end with `Co-Authored-By: Claude …`, and agent PRs carry an `Agent: <name>` line.

### 2. Claude Code settings (committed, sensitive)

- **Everyone's rules** (`.claude/settings.json`, every session in this repo): deny `Read(**/.env*)`;
  `Agent(daedalus-builder)`; Bash: pushes to `main`, `git push --force*`, `git commit --no-verify*`, `curl * | sh`,
  `npm publish*`, `gh repo delete*`, `gh pr merge*` and merges through `gh api` (the merge gate is the only way in).
- **Builder-only rules** (`.claude/builder/settings.json`, passed by `scripts/dispatch.ts` with `--settings`):
  - **Sandbox on:** `sandbox.enabled`, `failIfUnavailable`, `allowUnsandboxedCommands: false`. Writes are limited to
    the builder's clone and temp. Network goes only to an allowlist: npm registry, Playwright browser downloads,
    Google Fonts, and localhost for the task's own service ports. No Unix sockets (no Docker). The sandbox isn't in
    everyone's file: it would also stop Athena's own tools.
  - Deny `Edit` of `/.github/**`, `/.claude/**`, `/scripts/**`, `/CLAUDE.md`, `**/CLAUDE.md`, `/docs/plan/**`,
    `/DESIGN.md`, `pnpm-workspace.yaml`, lint/TypeScript/test/format configs (`tsconfig*.json`, `eslint.config.*`,
    `vitest.config.*`, `playwright.config.*`, `.prettierrc*`, `.prettierignore`), `.gitleaks.toml`, `.npmrc`,
    `.nvmrc`, `.mcp.json`, `.husky/**`, `.gitattributes`, `.vscode/**` and approved visual baselines. Paths match
    in any letter case (macOS treats `Claude.md` as `CLAUDE.md`). Bash: `git push*`, `gh *`, `security *` (the Keychain).
  - Deny reads of `~/.config/gh/**`, `~/.ssh/**`, `~/.letzeuspost/**` except the freeze flag, Picasso's instance
    folder (its `.env`) and every `.env*`: the sandbox limits writes, not reads.
  - The hooks apply the same rules when `LZP_ROLE=builder` (set only by dispatch, outside the builder's reach).
- `permissions.disableBypassPermissionsMode: "disable"` in both files, also set by Zeus in **managed settings** on the Mac.

### 3. Hooks (`.claude/hooks/`, committed, sensitive; they also fire for subagents)

Hooks run outside the sandbox, so a builder's hooks run from main's checkout: `.claude/builder/settings.json` registers
them under `$LZP_HARNESS_DIR`, and everyone's `.claude/settings.json` skips its own in a builder session. A builder's
PreToolUse hook that can't start refuses the call (`"onFailure": "block"`, checked on Claude Code 2.1.309). The hooks
read nothing a builder could have planted as anything but data: no symlink or hard link is followed, git runs in a
throwaway repository with only `--work-tree` on the clone, and prettier comes from main with the file after `--`.

| Hook | Does |
|---|---|
| SessionStart and PreToolUse | SessionStart loads the task from `.lzp/task.md` and the rules (Claude Code doesn't let SessionStart block). PreToolUse, on every tool call, refuses while Zeus's **freeze switch** is on: the repo variable `AGENTS_PAUSED`, which dispatch copies into `~/.letzeuspost/paused` every minute, with the time, because builders can't reach GitHub. For a builder a flag that is missing or older than 3 minutes counts as frozen, so a dead refresher fails closed; Athena and the reviewers stop on `paused: true` only (Zeus, 2026-11-08) |
| PreToolUse Bash | Blocks the dangerous patterns above (a backup to the deny rules) |
| PreToolUse Edit/Write | Blocks protected paths (builder); blocks content that looks like a secret; blocks silencing checks (`eslint-disable`, `@ts-ignore`, `.skip`, `.only`, lower coverage thresholds) unless a comment explains why |
| PostToolUse Edit/Write | Formats the changed file |
| Stop / SubagentStop (builder) | Won't let the builder finish while code changed after the last green `pnpm check` (a stamp of the git tree hash). The loop guard is checked at setup |
| All blocks | Logged to `~/.letzeuspost/logs/guardrail-hits.jsonl`, outside every builder clone so builders can't forge or delete it (Zeus, 2026-11-07), for the weekly report |

### 4. Checks (`pnpm check` locally; the CI job `ci` runs it and more)

**H0 (minimum):** frozen-lockfile install · TypeScript strict · ESLint · format · unit tests · **gitleaks** CLI ·
`pnpm audit` + OSV-Scanner · **zizmor** on workflows · a **dependency licence check** (below).

**Added when the work needs it:** squawk with the first migration · Playwright end-to-end with the first journey ·
visual tests, axe and `design.md lint` with the first UI ([21](21-ai-design-workflow.md)) · golden renders with the
render engine (§17) · Semgrep custom rules when the same bug pattern shows up twice · Lighthouse budgets before launch
· the `claude-code-security-review` Action if Cerberus misses things.

### 5. GitHub side (Free plan)

- No branch rules and no auto-merge on Free private repos. **Athena merges through the merge gate** ([19](19-build-team-and-workflow.md#the-merge-gate)): every check green, independent reviews passed, squash only. The gate works the tier out itself; the label is for people.
  Settings: squash merges only, Actions pinned to commit SHAs, least-privilege workflow permissions, Dependabot alerts on.
- **`risk-gate`** (CI) compares the changed paths with `.github/sensitive-paths.txt` (read from `main`, so a PR can't
  change its own tier) and labels the PR `sensitive` or `routine`. It flags any change to the harness and posts a
  short summary of what a `sensitive` PR touches.
- **Sensitive areas** (`.github/sensitive-paths.txt`): auth/permissions/billing code · database schema and migrations ·
  `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, Dockerfiles · AI prompts, AI policy, model/provider/plan
  config · `.github/**`, `.claude/**`, every `CLAUDE.md`, lint/TS/test configs · `docs/plan/**`, `DESIGN.md` ·
  baselines of **approved** screens and look presets. The exact paths are listed in [§13](13-architecture.md).
- **If Zeus upgrades to GitHub Pro later:** add a ruleset (required checks, no force pushes, no direct pushes to `main`),
  so GitHub enforces the merge gate's checks too.

### 6. Secrets

No real secrets on the builder side. Builders use local dev services and a **mocked AI provider**; live AI runs only
in the CI eval job, added with the AI pipeline. **CI secrets never meet PR code:** GitHub gives secrets to
`pull_request` runs from branches in the same repo, so the evals (`ANTHROPIC_API_KEY`) run only on `main` and by hand
(`workflow_dispatch`): for a PR that touches AI paths, Athena starts them on the PR branch after the reviews pass,
and the merge gate requires that check on the head commit; `ci` and `risk-gate` use no secrets, and `risk-gate` never
installs or runs the PR's code. `.env` stays local and unreadable to agents; `env.example` documents
the keys. CI secrets: none yet (no GitHub AI review, 2026-11-08); `ANTHROPIC_API_KEY` for evals later (a dedicated Anthropic
Console workspace with a monthly spend limit).

### 7. Cost and usage

Builders and reviewers run on Zeus's Claude subscription, so its usage limits are the real cap. H0 runs **1 builder**;
Athena only adds a second or third when the weekly report shows room. Any headless run on an API key gets
`--max-budget-usd`.

### Outside skills

- Vendor a copy pinned to a commit into `.claude/skills/<name>/` (Claude Code only finds skills one level deep, so no
  `vendor/` folder; amended 2026-11-07), with `SOURCES.md` listing the repo, commit, licence and every change we made.
  The agent files tell each agent to read its skills first: `skills:` preloading doesn't apply to headless `--agent` runs.
- **Licences (Zeus, 2026-11-06):** copy MIT and Apache skills. CC-BY-SA-4.0 instruction text (Trail of Bits) is
  allowed with attribution and its licence file kept beside it (private repo, not redistributed). Repos without a
  licence file are never copied (e.g. Better Auth's skills, Vercel's React rules: reference only). Scripts and code
  must be MIT or Apache.
- Read every file in full before adding it: no hidden instructions, no install scripts, no runtime downloads, no
  telemetry, **no hooks, and no plugins that add hooks** (no exceptions). Skills that run `npx …@latest` are pinned
  or rewritten. Run SkillSpector or Sentry's `skill-scanner` once on each skill before it lands.
- Adding or updating a skill is a `sensitive` change, recorded in `skills-lock.json`.

### Dependency licences

Allowed: MIT, Apache-2.0, BSD, ISC, the PostgreSQL licence, OFL for fonts and **BlueOak-1.0.0** (Zeus, 2026-11-07).
**Named exceptions:** LGPL libraries used unchanged as separate shared libraries: libvips (inside sharp; Zeus,
2026-11-06, §13 A14). **MPL-2.0 for dev-only tools used unchanged:** lightningcss and its platform packages (under
Vitest; Zeus, 2026-11-07); the check fails if one becomes a production dependency. (HEIC is converted by
Cloudflare Images, §16, so libheif and libde265 aren't used.) Anything else that isn't on the list fails the check until Zeus adds it.

## Not in the MVP

Builders merging any PR · server-side merge rules (need GitHub Pro) · a separate agent identity (bot account or
GitHub App) · signed commits · a self-hosted CI runner.

## Done when (milestone H0)

A red-team checklist passes. An agent tries each item and it is shown blocked:

- [ ] a builder pushing, opening a PR, commenting, labelling or merging, with `gh`, `gh api`, `curl` or `git push`
  (no credential) · a push to `main` · a force push
- [ ] the merge gate refusing a PR that fails any of its items (red check, missing review, stale review after a push or
  an edited PR text, a tier label that disagrees with the paths, frozen) · a builder writing the review record
- [ ] (added 2026-11-07, staging) a builder PR into `staging` touching a risky area merging without Cerberus · a harness
  path reaching `staging` · a batch into `main` merging without the full review, or with a task the gate never merged
  into `staging` · `staging` code running outside the sandbox or CI (only `main` deploys) · a direct push to `staging`
  (the batch gate refuses it; the weekly audit flags it and freezes)
- [ ] `scripts/ship.ts` refusing a branch that changes a builder-protected path (any letter case)
- [ ] a builder reaching Docker, another task's or Picasso's services, or planting a git hook or setting that runs
  when Athena ships
- [ ] a builder reading the Keychain or using Zeus's `gh` login · Daedalus started as Athena's subagent
- [ ] a builder editing `.github/`, `.claude/` or `scripts/` · reading `.env`
- [ ] `curl … | sh` · a network call outside the allowlist (GitHub included)
- [ ] committing a fake secret
- [ ] `.only` in a test · finishing without a green check
- [ ] working while frozen

## Depends on

[13](13-architecture.md) (folder names), [19](19-build-team-and-workflow.md).
