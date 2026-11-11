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
| `AI-AND-LLM.md` | yes |
| `CLIENT-SIDE.md` | no |
| `CLOUD-AND-DEPLOYMENT.md` | no |
| `DATA-ISOLATION-AND-LIFECYCLE.md` | no |
| `PROTOCOLS-RPC-AND-MESSAGING.md` | no |
| `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md` | no |
| `SUPPLY-CHAIN-AND-RELEASE.md` | yes |
| `WEB-PROTOCOL-AND-AUTH.md` | yes |

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
5. "Operating modes" note: "say that this copy can't run one and stop" → "… and carry on in guidance mode (a reviewer
   still gives its verdict)" (Cerberus's round-1 review of #53: a headless reviewer must not stop without a verdict).
   The note now names the three overridden lines (change 6).
6. Marked three upstream lines **overridden** where they appear, each with the rule that replaces it (Cerberus's
   round-1 review of #53):
   - `AI-AND-LLM.md` "Prompt injection alone is not a finding …": client text in a model's instructions is a finding
     by itself (§22);
   - `SUPPLY-CHAIN-AND-RELEASE.md` "A mutable or known-vulnerable dependency is not a finding by itself …": pinned
     dependencies and SHA-pinned actions;
   - `WEB-PROTOCOL-AND-AUTH.md` "A missing header, cookie attribute, MFA prompt, or rate limit is not a finding alone
     …": overridden for rate limits only.
7. The "Operating modes" note names two more lines that give way to hardening the plan or the loading agent requires:
   `SKILL.md` "Do not elevate a missing best practice … into a security finding" and `ATTACK-CLASSES.md` "A flag is not
   a finding" (#56, after Cerberus on #53). Neither file's line is edited; the note settles them.
8. 2026-11-11 (#236): `ATTACK-CLASSES.md` "A flag is not a finding" now carries the inline **(LetZeusPost: overridden
   …)** marker as well, since Cerberus reads the companions through `security-review`'s map and no longer reads this
   `SKILL.md` (round 2 of #237, Cerberus F2).

## Review notes

Every copied file read in full, and the left-out README and `SKILL.md` too. Text only: no hooks, install steps,
network calls or telemetry. Upstream's stance worth knowing: `AI-AND-LLM.md` says "prompt injection alone is not a
finding" without a code-level boundary failure. LetZeusPost's §22 and Cerberus's rules are stricter, so that line and
two like it are marked overridden (change 6).

## Scan

Sentry `skill-scanner` (`getsentry/skills` @ `e94f22214528d69899d09c627b3315ddc3544816`, `scripts/scan_skill.py`
run with `uv`), plus its same checks applied to every file in the folder: 0 findings on 2026-11-07. (A first run
flagged unparseable frontmatter: our new `description` had a `: `. Fixed before commit.)
