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
   agents, so it does both passes itself. The final-reply line now defers to the loading agent's format (Cerberus:
   verdict line first).
9. **Removed the confidence cutoff** (Cerberus's round-1 review of #53: Cerberus blocks when the files can't rule a
   risk out):
   - CRITICAL INSTRUCTIONS 1 "MINIMIZE FALSE POSITIVES: Only flag issues where you're >80% confident of actual
     exploitability" → "REPORT WHAT THE FILES CAN'T RULE OUT", and 2 lost "Skip theoretical issues … or low-impact
     findings";
   - CONFIDENCE SCORING "Below 0.7: Don't report (too speculative)" → report it with what would rule it out;
   - FINAL REMINDER "Focus on HIGH and MEDIUM findings only. Better to miss some theoretical issues than flood the
     report with false positives" → lead with HIGH and MEDIUM, a missed hole costs more;
   - PRECEDENTS "8. Only include MEDIUM findings if they are obvious and concrete issues." removed;
   - START ANALYSIS step 3 "Filter out any vulnerabilities with a confidence less than 8" → drop only what the
     false-positive pass shows is not a risk.
10. **Removed the exclusions that hid what Cerberus checks:**
   - top-level EXCLUSIONS "Secrets or sensitive data stored on disk (these are handled by other processes)", replaced
     by CRITICAL INSTRUCTIONS 4 "IN SCOPE HERE" (prompt, agent, skill and `CLAUDE.md` files, `docs/plan/`, workflows,
     dependencies, secrets on disk, required hardening);
   - HARD EXCLUSIONS "1. Secrets or credentials stored on disk if they are otherwise secured.", "3. Input
     sanitization concerns for GitHub Action workflows …", "4. A lack of hardening measures …", "6. Vulnerabilities
     related to outdated third-party libraries …", "11. Regex injection …" (it hid regex denial of service) and "12.
     Insecure documentation. Do not report any findings in documentation files such as markdown files.";
   - PRECEDENTS "6. Most vulnerabilities in github action workflows are not exploitable in practice …".
   The "NOT EXCLUDED in this fork" line names each.
11. HARD EXCLUSIONS 5 (now 2), theoretical races: added that a builder's processes racing Athena's scripts on files
   in its clone are practical here.
12. PRECEDENTS 4 (subtle web issues) "should not be reported unless they are extremely high confidence" → "are LOW
   unless the files show a concrete attack path"; PRECEDENTS 11 (now 9, shell command injection): added that text
   from builders, issues, PR bodies and review findings is untrusted wherever it reaches a shell.
13. Renumbered again: hard exclusions 1–7, precedents 1–9; the `description` names the removed cutoff and
   exclusions.
14. Round 3 of #53 (#56):
   - OBJECTIVE "identify HIGH-CONFIDENCE security vulnerabilities" → "identify security vulnerabilities …, with a
     confidence for each";
   - SIGNAL QUALITY CRITERIA 2: added that a risk the files can't rule out stays in;
   - HARD EXCLUSIONS 4 "Files that are only unit tests or only used as part of running tests." → vulnerabilities in
     test-only code paths; weakened, skipped or removed security or tenancy tests and real secrets in fixtures stay in
     scope;
   - PRECEDENTS 2 (UUIDs unguessable): limited to random record IDs, with a note that ours are UUIDv7 (time-ordered)
     and that invite and review-link tokens are random secrets of at least 128 bits, stored as hashes (§13);
   - PRECEDENTS 3 (environment variables trusted): a note that variables a builder or its scripts can set, such as
     `LZP_ROLE`, are untrusted.

## Review notes

Read in full. No hooks or downloads; the only executable content was the bang-backtick `git` blocks and the
`allowed-tools` grant, both removed. No exclusion that conflicts with Cerberus's checks is left (changes 9 and 10);
change 3's note still settles anything this prompt and Cerberus say differently.

## Scan

Sentry `skill-scanner` (`getsentry/skills` @ `e94f22214528d69899d09c627b3315ddc3544816`, `scripts/scan_skill.py`
run with `uv`), plus its same checks applied to every file in the folder: 0 findings on 2026-11-07.
