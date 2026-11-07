# Sources: security-review

- **Repo:** https://github.com/anthropics/claude-code-security-review
- **Commit:** `0c6a49f1fa56a1d472575da86a94dbc1edb78eda` (main, 2026-02-11)
- **Licence:** MIT (`LICENSE`, copied from the repo root, beside this file)
- **Vendored:** 2026-11-07 by Athena (task #31). Our fork for Cerberus.
- **Discovery:** the skill lives directly at `.claude/skills/security-review/` (Claude Code finds skills one level deep; no symlinks, no `vendor/` folder). A project skill with this name
  replaces Claude Code's built-in `/security-review` (checked on 2026-11-07: the session listed our description).

## Paths copied

| Upstream | Here | Changed |
|---|---|---|
| `.claude/commands/security-review.md` | `SKILL.md` | yes |
| `LICENSE` | `LICENSE` | no |

The GitHub Action (`action.yml`, `claudecode/**`, `scripts/**`) was not copied.

## Changes we made

1. **Frontmatter:** added `name: security-review` and our own `description`; **removed `allowed-tools`** (it
   pre-approved `Bash(git …)` and `Task`; Cerberus has only Read, Grep and Glob).
2. **Removed the four bang-backtick shell blocks** (`git status`, `git diff --name-only`, `git log`, `git diff
   --merge-base`). In a skill they run shell commands at load time. Replaced with one line: the diff, changed files,
   history and clone are given as files.
3. Added a note at the top: this is a fork, and where it differs from the loading agent (Cerberus), the agent's rules
   win, including its output format and its checks on dependencies, workflows and harness files.
4. **Removed the denial-of-service and rate-limit exclusions:**
   - top-level EXCLUSIONS: "Denial of Service (DOS) vulnerabilities, even if they allow service disruption" and
     "Rate limiting or resource exhaustion issues";
   - HARD EXCLUSIONS: "1. Denial of Service (DOS) vulnerabilities or resource exhaustion attacks.", "3. Rate
     limiting concerns or service overload scenarios.", "4. Memory consumption or CPU exhaustion issues.", "16. Regex
     DOS concerns.";
   - PRECEDENTS: "4. Resource management issues such as memory or file descriptor leaks are not valid."
5. **Removed the prompt-injection exclusion:** HARD EXCLUSIONS "14. Including user-controlled content in AI system
   prompts is not a vulnerability."
6. Added two categories so the reviewer looks for what 4 and 5 used to hide: **Availability & Abuse** (DoS, rate
   limits, resource and regex exhaustion, AI cost abuse) and **AI & Prompt Injection** (client text in prompt
   instructions, unchecked model output, secrets or other workspaces' data reachable through a model's context), plus
   a "NOT EXCLUDED in this fork" line under the hard exclusions.
7. Renumbered the remaining hard exclusions (1–13; upstream numbered two items 16) and precedents (1–11).
8. START ANALYSIS: upstream launches sub-tasks to find issues and to filter false positives. Cerberus can't start
   agents, so it does both passes itself; the confidence threshold (8) is unchanged. The final-reply line now defers to
   the loading agent's format (Cerberus: verdict line first).

## Review notes

Read in full. No hooks or downloads; the only executable content was the bang-backtick `git` blocks and the
`allowed-tools` grant, both removed. Exclusions kept that conflict with Cerberus's own checks (its rules win, per
change 3): HARD EXCLUSIONS 6 "outdated third-party libraries", 12 "Insecure documentation … markdown files" (our
agent and skill `.md` files are prompts), and the GitHub Actions items (HARD EXCLUSIONS 3, PRECEDENTS 6).

## Scan

Sentry `skill-scanner` (`getsentry/skills` @ `e94f22214528d69899d09c627b3315ddc3544816`, `scripts/scan_skill.py`
run with `uv`), plus its same checks applied to every file in the folder: 0 findings on 2026-11-07.
