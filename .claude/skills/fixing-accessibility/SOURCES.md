# Sources: fixing-accessibility

- **Repo:** https://github.com/ibelick/ui-skills
- **Commit:** `97dea9e747ea94d5671ef1468cbb8f9bd5f32542` (main, 2026-11-07). `skills/fixing-accessibility/` last
  changed in `edda651` (2026-06-11).
- **Licence:** MIT (`LICENSE`, copied from the repo root, beside this file)
- **Vendored:** 2026-11-08 by Athena (task #68). Zeus approved the UI start set on 2026-11-08. Used as-is (§21).
- **Discovery:** the skill lives directly at `.claude/skills/fixing-accessibility/` (Claude Code finds skills one level deep; no symlinks, no `vendor/` folder).

## Paths copied

From `skills/fixing-accessibility/`:

| File | Changed |
|---|---|
| `SKILL.md` | no |
| `LICENSE` (repo root) | no |

## Left out

Nothing from the skill folder (it holds only `SKILL.md`). The rest of the repo is the ui-skills website and CLI and
other skills not in the start set.

## Changes we made

None.

## Review notes

Read in full. Markdown only: no hooks, scripts, install steps, network calls or telemetry. The HTML comments in it are
visible before/after examples inside a code block. It names no WCAG version or contrast numbers ("ensure sufficient
contrast"); `web-interface-guidelines` and `accessibility` set WCAG 2.2 AA as the bar.

## Scan

Sentry `skill-scanner` (`getsentry/skills` @ `e94f22214528d69899d09c627b3315ddc3544816`, `scripts/scan_skill.py`
run with `uv`), plus its same checks applied to every file in the folder: 0 findings on 2026-11-08. No URLs.
