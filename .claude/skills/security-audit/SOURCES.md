# Sources: security-audit

- **Repo:** https://github.com/cloudflare/security-audit-skill
- **Commit:** `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` (main, 2026-09-14)
- **Licence:** MIT (`LICENSE`, copied from the repo root, beside this file)
- **Vendored:** 2026-11-07 by Athena (task #31), for Cerberus in **guidance mode only**.
- **Discovery:** the skill lives directly at `.claude/skills/security-audit/` (Claude Code finds skills one level deep; no symlinks, no `vendor/` folder).

## Paths copied

From `skills/security-audit/`:

| File | Changed |
|---|---|
| `SKILL.md` | yes |
| `ATTACK-CLASSES.md` | no |
| `AI-AND-LLM.md` | no |
| `CLIENT-SIDE.md` | no |
| `CLOUD-AND-DEPLOYMENT.md` | no |
| `DATA-ISOLATION-AND-LIFECYCLE.md` | no |
| `PROTOCOLS-RPC-AND-MESSAGING.md` | no |
| `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md` | no |
| `SUPPLY-CHAIN-AND-RELEASE.md` | no |
| `WEB-PROTOCOL-AND-AUTH.md` | no |

## Left out

- `validate-findings.cjs`, `validate-coverage-ledger.cjs` (about 62 KB of Node, not tiny) and their `.test.cjs`
  files: only the full-audit workflow uses them. Guidance mode is text only.
- `report-schema.json`, `RECONNAISSANCE.md`, `HUNTING.md`, `VALIDATION-AND-REPORTING.md`: the full-audit phases
  (sub-agent hunters, output folders under `~/security-audit-skill/`, report files). Cerberus is read-only with no
  sub-agents, so it can't run them.
- `MEMORY-SAFETY-AND-BINARY.md`, `DESKTOP-MOBILE-AND-LOCAL-IPC.md`: native code and desktop/mobile apps; not our
  stack. `ATTACK-CLASSES.md` and some companions still link to them.
- `README.md`: install instructions (`npx skills add …`) and contact details only.

## Changes we made

1. Frontmatter `description`: says the copy is guidance mode only and does not run the full audit workflow (dropped "Run the complete workflow only for …").
2. "Operating modes": a LetZeusPost note (what's missing, to stop if a full audit is asked for, to skip links to files
   that aren't here, and that the loading agent's rules and §13/§22 win where they differ, e.g. client text in prompt
   instructions is a finding without a proven chain). Removed the "Full audit mode" bullet, the "ask one question"
   line, and "You may launch focused agents".
3. Removed the sections "Full audit setup" (with "Write isolation"), "Full audit planning" (coverage, prior runs,
   profiles, cost budget) and "Full audit workflow".
4. "Universal execution safety": "apply in both operating modes" → "apply in guidance mode"; removed the sentence on
   promoting artifacts in full audit mode.

## Review notes

Every copied file read in full, and the left-out README and `SKILL.md` too. Text only: no hooks, install steps,
network calls or telemetry. Upstream's stance worth knowing: `AI-AND-LLM.md` says "prompt injection alone is not a
finding" without a code-level boundary failure. LetZeusPost's §22 and Cerberus's rules are stricter, which is why
change 2 says ours win.

## Scan

Sentry `skill-scanner` (`getsentry/skills` @ `e94f22214528d69899d09c627b3315ddc3544816`, `scripts/scan_skill.py`
run with `uv`), plus its same checks applied to every file in the folder: 0 findings on 2026-11-07. (A first run
flagged unparseable frontmatter: our new `description` had a `: `. Fixed before commit.)
