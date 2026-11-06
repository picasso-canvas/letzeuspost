# Section 20: Builder guardrails (Approved 2026-11-06, revised 2026-11-06)

> **Stack:** decided in [§13](13-architecture.md) (approved 2026-11-06). Where this doc differs, §13 wins.

**Goal:** agents build safely: they can't change the rules or CI, leak secrets, merge anything, or run up costs.

Permission rules and hooks are a first line of defense only; Claude Code's own docs say they are **not a security
boundary** (checked on code.claude.com, 2026-11-06). The hard limits here come from the **sandbox**, the **repo-only
token** (GitHub enforces its permissions) and **Zeus merging every PR**.

## Revisions (2026-11-06, same day)

1. **No bot account.** A separate `letzeuspost-bot` account was suspended by GitHub; Zeus chose to keep it simple.
2. **Zeus merges every PR.** Zeus's account is on GitHub Free, and GitHub refuses rulesets and auto-merge on a
   private repo on Free ("Upgrade to GitHub Pro or make this repository public"). Zeus chose to stay on Free and merge
   himself, instead of upgrading or making the repo public.
3. **A repo-only token for agents**, so GitHub itself limits what they can do.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| Which changes need extra care? | **Sensitive areas**: auth / permissions / billing · database migrations · dependencies · AI prompts and product AI rules · the guardrails, CI and harness themselves |
| Which GitHub identity do agents use? | Zeus's account, through a fine-grained **repo-only token** |
| Merge gate? | Zeus merges every PR (stay on GitHub Free) |
| Cost limits? | Caps for building and for the product |
| Outside skill licences? | MIT/Apache; CC-BY-SA-4.0 text with attribution; never copied from repos without a licence |

## Spec

### 1. Identity and access

- Agents use a **fine-grained personal access token on Zeus's account, limited to this one repo**, with only:
  Contents read/write · Pull requests read/write · Issues read/write · Actions read · Commit statuses read ·
  Variables read · Metadata read. **No** Administration, Secrets, Workflows, Environments, Webhooks or Deployments.
  It expires after 90 days.
- GitHub enforces that token's limits: agents **can't** change repo settings, secrets or variables, edit CI
  workflow files, delete the repo, or reach any other repo (including the editz studio).
- The token lives in the macOS Keychain (item `letzeuspost-agent-token`), never in a file or in chat. Athena starts
  builder sessions with it as `GH_TOKEN`; builders never see Zeus's own login.
- What the token can't stop: it can push to any branch (Free has no branch protection), and it can't reach the
  project board (fine-grained tokens don't support boards owned by a personal account). So deny rules and hooks block
  pushes to `main` and every merge, Athena moves board cards with Zeus's login, and the board's built-in workflow
  marks closed items Done.
- Agent commits end with `Co-Authored-By: Claude …`, and agent PRs carry an `Agent: <name>` line.

### 2. Claude Code settings (`.claude/settings.json`, committed, sensitive)

- **Sandbox on:** `sandbox.enabled`, `failIfUnavailable`, `allowUnsandboxedCommands: false`. Writes are limited to
  the worktree and temp. Network goes only to an allowlist: npm registry, GitHub, Playwright browser downloads, Google
  Fonts, localhost.
- **Deny rules:** `Read(**/.env*)`; `Edit` of `/.github/**`, `/.claude/**`, `/CLAUDE.md`, `**/CLAUDE.md`,
  `/docs/plan/**`, `/DESIGN.md`, lint/TypeScript/test configs and approved visual baselines. Bash: any `gh pr merge`,
  pushes to `main`, `git push --force*`, `git commit --no-verify*`, `gh auth*`, `security *` (the Keychain),
  `curl * | sh`, `npm publish*`, `gh repo delete*`, `gh repo edit*`, `gh secret*`, `gh variable*`, `gh ruleset*`, and
  `gh pr edit` / `gh issue edit` on the `sensitive` / `routine` labels.
- `permissions.disableBypassPermissionsMode: "disable"`, also set by Zeus in **managed settings** on the Mac.

### 3. Hooks (`.claude/hooks/`, committed, sensitive; they also fire for subagents)

| Hook | Does |
|---|---|
| SessionStart | Loads the active issue, its Done-when and the rules; stops at once if the repo variable `AGENTS_PAUSED` is true (Zeus's **freeze switch**) |
| PreToolUse Bash | Blocks the dangerous patterns above (a backup to the deny rules) |
| PreToolUse Edit/Write | Blocks protected paths; blocks content that looks like a secret; blocks silencing checks (`eslint-disable`, `@ts-ignore`, `.skip`, `.only`, lower coverage thresholds) unless a comment explains why |
| PostToolUse Edit/Write | Formats the changed file |
| Stop / SubagentStop (builder) | Won't let the builder finish while code changed after the last green `pnpm check` (a stamp of the git tree hash). The loop guard is checked at setup |
| All blocks | Logged to `.claude/logs/guardrail-hits.jsonl` (gitignored) for the weekly report |

### 4. Checks (`pnpm check` locally = the CI job `ci`)

**H0 (minimum):** frozen-lockfile install · TypeScript strict · ESLint · format · unit tests · **gitleaks** CLI ·
`pnpm audit` + OSV-Scanner · **zizmor** on workflows · a **dependency licence check** (below).

**Added when the work needs it:** squawk with the first migration · Playwright end-to-end with the first journey ·
visual tests, axe and `design.md lint` with the first UI ([21](21-ai-design-workflow.md)) · golden renders with the
render engine (§17) · Semgrep custom rules when the same bug pattern shows up twice · Lighthouse budgets before launch
· the `claude-code-security-review` Action if Cerberus misses things.

### 5. GitHub side (Free plan)

- No branch rules and no auto-merge on Free private repos. **Zeus merges each PR when the checks are green.**
  Settings: squash merges only, Actions pinned to commit SHAs, least-privilege workflow permissions, Dependabot alerts on.
- **`risk-gate`** (CI) compares the changed paths with `.github/sensitive-paths.txt` (read from `main`, so a PR can't
  change its own tier) and labels the PR `sensitive` or `routine`. It flags any change to the harness and posts a
  short summary of what a `sensitive` PR touches.
- **Sensitive areas** (`.github/sensitive-paths.txt`): auth/permissions/billing code · database schema and migrations ·
  `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, Dockerfiles · AI prompts, AI policy, model/provider/plan
  config · `.github/**`, `.claude/**`, every `CLAUDE.md`, lint/TS/test configs · `docs/plan/**`, `DESIGN.md` ·
  baselines of **approved** screens and look presets. The exact paths are listed in [§13](13-architecture.md).
- **`ai-review`**: `anthropics/claude-code-action@v1` with Zeus's `claude_code_oauth_token` and the code-review plugin
  posts inline comments on every PR. It is advice for Zeus, not a gate.
- **If Zeus upgrades to GitHub Pro later:** add a ruleset (required checks, no force pushes, no direct pushes to `main`)
  and reconsider agents merging `routine` PRs.

### 6. Secrets

No real secrets on the builder side. Builders use local dev services and a **mocked AI provider**; live AI runs only
in the CI eval job, added with the AI pipeline. `.env` stays local and unreadable to agents; `.env.example` documents
the keys. CI secrets: `CLAUDE_CODE_OAUTH_TOKEN` now; `ANTHROPIC_API_KEY` for evals later (a dedicated Anthropic
Console workspace with a monthly spend limit).

### 7. Cost and usage

Builders and reviewers run on Zeus's Claude subscription, so its usage limits are the real cap. H0 runs **1 builder**;
Athena only adds a second or third when the weekly report shows room. Any headless run on an API key gets
`--max-budget-usd`. The GitHub review has a turn limit.

### Outside skills

- Vendor a copy pinned to a commit into `.claude/skills/vendor/<name>/`, with `SOURCES.md` listing the repo, commit,
  licence and every change we made.
- **Licences (Zeus, 2026-11-06):** copy MIT and Apache skills. CC-BY-SA-4.0 instruction text (Trail of Bits) is
  allowed with attribution and its licence file kept beside it (private repo, not redistributed). Repos without a
  licence file are never copied (e.g. Better Auth's skills, Vercel's React rules: reference only). Scripts and code
  must be MIT or Apache.
- Read every file in full before adding it: no hidden instructions, no install scripts, no runtime downloads, no
  telemetry, **no hooks, and no plugins that add hooks** (no exceptions). Skills that run `npx …@latest` are pinned
  or rewritten. Run SkillSpector or Sentry's `skill-scanner` once on each skill before it lands.
- Adding or updating a skill is a `sensitive` change, recorded in `skills-lock.json`.

### Dependency licences

Allowed: MIT, Apache-2.0, BSD, ISC, the PostgreSQL licence, and OFL for fonts. **Named exception (Zeus, 2026-11-06,
§13 A14):** LGPL libraries used unchanged as separate shared libraries: libvips (inside sharp), and libheif with
libde265 for decoding HEIC. Anything else that isn't on the list fails the check until Zeus adds it.

## Not in the MVP

Agents merging their own PRs and server-side merge rules (need GitHub Pro) · a separate agent identity (bot account or
GitHub App) · signed commits · a self-hosted CI runner.

## Done when (milestone H0)

A red-team checklist passes. An agent tries each item and it is shown blocked:

- [ ] any `gh pr merge` · a push to `main` · a force push
- [ ] the agent token changing a setting, secret, variable or workflow file (GitHub refuses)
- [ ] reading the Keychain or switching `gh` accounts
- [ ] editing `.github/` or `.claude/` · reading `.env`
- [ ] `curl … | sh` · a network call outside the allowlist
- [ ] committing a fake secret
- [ ] `.only` in a test · finishing without a green check
- [ ] working while frozen

## Depends on

[13](13-architecture.md) (folder names), [19](19-build-team-and-workflow.md).
