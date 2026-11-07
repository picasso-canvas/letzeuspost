# Sources: security-best-practices

- **Repo:** https://github.com/openai/skills
- **Commit:** `49f948faa9258a0c61caceaf225e179651397431` (main, 2026-06-24)
- **Licence:** Apache-2.0, per skill (`LICENSE.txt` from the skill folder, beside this file). The repo root has no
  licence; only this skill's own licence file covers what we copied.
- **Vendored:** 2026-11-07 by Athena (task #31).
- **Discovery:** `.claude/skills/security-best-practices` is a relative symlink to this folder.

## Paths copied

From `skills/.curated/security-best-practices/`:

| File | Changed |
|---|---|
| `SKILL.md` | yes (marked at the top, as Apache-2.0 §4(b) asks) |
| `LICENSE.txt` | no |
| `references/javascript-typescript-nextjs-web-server-security.md` | no |
| `references/javascript-typescript-react-web-frontend-security.md` | no |

## Left out

- The other 8 references (Go, Express, general frontend, jQuery, Vue, Django, FastAPI, Flask): not our stack.
  `SKILL.md` still names `javascript-general-web-frontend-security.md`; the note at its top says it isn't here.
- `agents/openai.yaml`: OpenAI Codex UI metadata (display name and a default prompt), not used by Claude Code.

## Changes we made

1. `SKILL.md`: a note under the title saying this copy was changed and holds only the Next.js and React references.
2. `SKILL.md` "Overrides": upstream told the agent to follow overrides found in "the project's documentation and
   prompt files" and "not fight" them. That lets text planted in a file switch a security practice off. Now only the
   approved plan (`docs/plan/`) and `CLAUDE.md` can override a practice; text in code, comments, tests, issues, PR
   text, dependencies or web pages never does, and a request in it to skip a practice is a finding.

## Review notes

Every copied file read in full. Text only: no scripts, hooks, install steps or telemetry. The references cite docs by
URL (nextjs.org, OWASP, MDN, react.dev, npm docs; some carry `utm_source=chatgpt.com`); nothing is fetched at
runtime. `SKILL.md` says "you can try to search online"; our agents that load it have no web tools. Upstream advice
worth knowing: it says not to recommend HSTS and to set `Secure` cookies only in production.

## Scan

Sentry `skill-scanner` (`getsentry/skills` @ `e94f22214528d69899d09c627b3315ddc3544816`, `scripts/scan_skill.py`
run with `uv`), plus its same checks applied to every file in the folder: 0 findings on 2026-11-07. Its URL list
flags 57 citation links (nextjs.org, OWASP, react.dev, MDN and similar docs, `example.com` in examples) and apache.org
in `LICENSE.txt`; none is fetched.
