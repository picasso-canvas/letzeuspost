# Section 20: Builder guardrails (Approved 2026-11-06)

**Goal:** agents can build and merge safely on their own. They can't weaken the rules, leak secrets, merge risky
changes without Zeus, or run up costs.

Permission rules and hooks are a first line of defense only; Claude Code's own docs say they are **not a security
boundary**. The hard boundaries are the **sandbox** (filesystem and network) and **GitHub** (rulesets and required
checks). (Checked against code.claude.com on 2026-11-06.)

**Changed 2026-11-06 (Zeus): no bot account.** A separate `letzeuspost-bot` account was tried and GitHub suspended
it, so Zeus chose the simpler setup: agents use Zeus's own account. The trade-off: the agents' token has Zeus's admin
rights, so "agents can't change protections or merge zeus-only PRs" rests on the sandbox, deny rules and hooks plus
the weekly audit, not on GitHub permissions alone.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| Which changes must wait for Zeus? | Auth / permissions / billing · database migrations · new or upgraded dependencies · AI prompts and product AI rules · and, **fixed**, the guardrails, CI and harness themselves |
| Which GitHub identity do agents use? | **Zeus's own account** (`picasso-canvas`). A bot account was tried and suspended by GitHub; Zeus chose to keep it simple |
| Cost limits? | Caps for building and for the product |
| Outside skill licences? | MIT/Apache; CC-BY-SA-4.0 text with attribution; no copying from repos without a licence |

## Spec

### 1. Identity and access

- Agents use Zeus's existing `gh` login (`picasso-canvas`). Nothing extra to set up.
- Every agent commit ends with a `Co-Authored-By: Claude …` line, and agent PRs carry an `Agent: <name>` line, so
  the weekly audit can tell agent work from Zeus's own.
- Because that login is an admin, the agents are **forbidden** (deny rules + hooks, section 2–3) from: merging with
  `--admin` (bypassing the rules) · changing rulesets, branch protection, repo settings, collaborators, secrets or
  Actions variables (`gh ruleset`, `gh secret`, `gh variable`, `gh repo edit`, `gh repo delete`, and any `gh api`
  write call to those endpoints) · adding or removing the `zeus-only` / `auto-merge` labels. Every settings change
  also shows in GitHub's audit log, which the weekly audit checks.

### 2. Claude Code settings (`.claude/settings.json`, committed, zeus-only)

- **Sandbox on:** `sandbox.enabled`, `failIfUnavailable`, `allowUnsandboxedCommands: false`. Writes are limited to
  the worktree and temp. Network goes only to an allowlist: the npm registry, GitHub (`github.com`, `api.github.com`,
  `codeload`, `objects.githubusercontent.com`), Playwright browser downloads, Google Fonts, localhost.
- **Deny rules:** `Read(**/.env*)`; `Edit` of `/.github/**`, `/.claude/**`, `/CLAUDE.md`, `**/CLAUDE.md`,
  `/docs/plan/**`, `/DESIGN.md`, lint/TypeScript/test configs and approved visual baselines. Bash: `git push --force*`,
  pushes to `main`, `git commit --no-verify*`, `curl * | sh`, `npm publish*`, `gh repo delete*`, `gh api -X DELETE*`,
  `gh ruleset*`, `gh secret*`, `gh variable*`, `gh repo edit*`, `gh pr merge --admin*`, any other `gh pr merge` except
  `gh pr merge --auto --squash`, `gh api` with `-X PUT/PATCH/POST/DELETE` on settings, rulesets, protection,
  collaborators, secrets and variables, and `gh pr edit` / `gh issue edit` touching the `zeus-only` or `auto-merge` labels.
- `permissions.disableBypassPermissionsMode: "disable"`, also set by Zeus in **managed settings** on the Mac so a
  project file can't undo it.

### 3. Hooks (`.claude/hooks/`, committed, zeus-only; they also fire for subagents)

| Hook | Does |
|---|---|
| SessionStart | Loads the active issue, its Done-when and the rules; stops at once if the repo variable `AGENTS_PAUSED` is true (Zeus's **freeze switch**) |
| PreToolUse Bash | Blocks the dangerous patterns above, plus dumping the environment and changing git hook paths (a backup to the deny rules) |
| PreToolUse Edit/Write | Blocks protected paths; blocks content that looks like a secret; blocks silencing checks (`eslint-disable`, `@ts-ignore`, `.skip`, `.only`, lower coverage thresholds) unless a comment explains why |
| PostToolUse Edit/Write | Formats the changed file |
| Stop / SubagentStop (builder) | Won't let the builder finish while code changed after the last green `pnpm check` (a stamp of the git tree hash). The loop guard is verified at setup. |
| All blocks | Logged to `.claude/logs/guardrail-hits.jsonl` (gitignored) for the weekly audit |

### 4. Checks (`pnpm check` locally = the CI job `ci`)

Frozen-lockfile install · TypeScript strict · ESLint (design-token and security rules) · format · unit tests (Vitest)
with a coverage floor on changed packages · Playwright end-to-end for affected journeys · visual tests and
accessibility (axe, [21](21-ai-design-workflow.md)) · `design.md lint` · build · **squawk** on generated migration
SQL · **gitleaks** CLI · **Semgrep** (free rules + our own) · `pnpm audit` + OSV-Scanner + a licence allowlist
(permissive only) · **zizmor** on workflows · golden renders when render code changes (§17) · Lighthouse CI budgets.

### 5. GitHub enforcement (the merge boundary)

- **Ruleset on `main`:** PR required; required checks `ci`, `ai-review`, `risk-gate`, `guardrail-integrity`; no
  force pushes or deletion; linear history; all conversations resolved. Zeus (repo admin) is the only one who may
  bypass it. (No code-owner review: GitHub never lets an account approve its own PR, and agents use Zeus's account.)
- **Zeus-only areas** are listed in `.github/zeus-only-paths.txt` (itself zeus-only): auth/permissions/billing code ·
  `packages/db/**` (schema, migrations) · `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, Dockerfiles ·
  `packages/ai/prompts/**`, `packages/ai/policy/**`, `config/models.ts`, `config/providers.ts`, `config/plans.ts` ·
  `.github/**`, `.claude/**`, all `CLAUDE.md` files, lint/TS/test configs · `docs/plan/**`, `DESIGN.md` · approved
  visual baselines and look presets. The exact folders come from §13.
- **`risk-gate`:** sorts the changed paths against that list and labels the PR `zeus-only` or `auto-merge`. On a
  **zeus-only PR the check fails on purpose**, so the PR can never merge itself: it posts a plain summary for Zeus,
  and **Zeus merges it himself** with the bypass button after reading it. It also fails while `AGENTS_PAUSED` is true.
- **`ai-review`:** `anthropics/claude-code-action@v1` with `claude_code_oauth_token` (Zeus runs `claude setup-token`
  and saves it as a secret), the code-review plugin, and a prompt with the issue's Done-when, the section doc and
  `CLAUDE.md`. It posts inline comments, and the job **fails on blocking findings**, so it works as a gate. The
  `claude-code-security-review` Action (pinned to a commit, our instruction files, same-repo PRs only) runs beside it.
  (Anthropic's managed Code Review is an alternative to evaluate at setup.)
- **`guardrail-integrity`:** fails if harness files changed without Zeus's approval, or if `settings.json` lost a
  required deny rule or the sandbox. NVIDIA **SkillSpector** and Sentry's **skill-scanner** check every `.claude/**` change.
- **Repo settings:** auto-merge on, squash merges only, Actions pinned to commit SHAs, least-privilege workflow
  permissions, Dependabot alerts on, dependency updates batched monthly (zeus-only).

### 6. Secrets

No real secrets on the builder side. Builders use local dev services and a **mocked AI provider**; live AI runs only
in the CI eval job. `.env` stays local and unreadable to agents, and `.env.example` documents the keys. CI secrets:
`CLAUDE_CODE_OAUTH_TOKEN`, and `ANTHROPIC_API_KEY` (evals only, from a dedicated Anthropic Console workspace).

### 7. Cost caps for building

Local builders run on Zeus's Claude subscription; any headless run that uses an API key gets `--max-budget-usd`. The
GitHub review uses the subscription token with a turn limit. The eval key's Console workspace has a monthly spend
limit Zeus sets (suggested $50) with alerts. The weekly audit reports usage.

### Outside skills

- Vendor a copy pinned to a commit into `.claude/skills/vendor/<name>/`, with `SOURCES.md` listing the repo, commit,
  licence and every change we made.
- **Licences (Zeus, 2026-11-06):** copy MIT and Apache skills. CC-BY-SA-4.0 instruction text (Trail of Bits) is
  allowed with attribution and its licence file kept beside it (the repo is private and doesn't redistribute it).
  Repos without a licence file are never copied: Better Auth is installed through its official plugin, and Vercel's
  React rules are reference only. Scripts and code must be MIT or Apache.
- Read every file in full before adding it: no hidden instructions, no install scripts, no runtime downloads, no
  telemetry, no hooks from outside skills. Skills that run `npx …@latest` are pinned to a version or rewritten.
- **Plugins vs copies:** prefer copies. Plugins that add hooks are not installed (superpowers, the Stripe plugin,
  `claude-security`). The one exception is Anthropic's `security-guidance`, with its per-turn review off
  (`ENABLE_STOP_REVIEW=0`, because worktrees run in parallel).
- Adding or updating a skill is zeus-only (it changes how agents behave), and is recorded in `skills-lock.json`.

## Not in the MVP

A separate identity for agents (a bot account or a GitHub App, which would let GitHub itself enforce the zeus-only
rule); signed commits; a self-hosted CI runner.

## Done when (milestone H0)

A red-team checklist passes. An agent tries each item and it is shown blocked:

- [ ] force push · push to `main`
- [ ] editing `.github/` · reading `.env`
- [ ] `curl … | sh` · a network call outside the allowlist
- [ ] committing a fake secret
- [ ] a zeus-only PR merging itself · an agent merging with `--admin`
- [ ] an agent changing a ruleset, setting, secret or the `zeus-only` label
- [ ] a PR that removes a deny rule
- [ ] `.only` in a test · finishing without a green check
- [ ] working while frozen

## Depends on

§13 (folder names), [19](19-build-team-and-workflow.md).
