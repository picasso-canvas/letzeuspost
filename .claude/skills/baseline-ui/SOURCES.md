# Sources: baseline-ui

- **Repo:** https://github.com/ibelick/ui-skills
- **Commit:** `97dea9e747ea94d5671ef1468cbb8f9bd5f32542` (main, 2026-11-07). `skills/baseline-ui/` last changed in
  `edda651` (2026-06-11).
- **Licence:** MIT (`LICENSE`, copied from the repo root, beside this file)
- **Vendored:** 2026-11-08 by Athena (task #68). Zeus approved the UI start set on 2026-11-08. Used as-is (§21).
- **Discovery:** the skill lives directly at `.claude/skills/baseline-ui/` (Claude Code finds skills one level deep; no symlinks, no `vendor/` folder).

## Paths copied

From `skills/baseline-ui/`:

| File | Changed |
|---|---|
| `SKILL.md` | no |
| `LICENSE` (repo root) | no |

## Left out

Nothing from the skill folder (it holds only `SKILL.md`). The rest of the repo is the ui-skills website and CLI
(`bin/ui-skills`, `scripts/`, Astro site, D1 migrations, GitHub workflows) and other skills not in the start set.

## Changes we made

None.

## Review notes

Read in full. Markdown only: no hooks, scripts, install steps, network calls or telemetry. Upstream's rules worth
knowing: "NEVER add animation unless it is explicitly requested", "NEVER use gradients unless explicitly requested",
"SHOULD limit accent color usage to one per view", `motion/react` for JavaScript animation, `tw-animate-css` for
entrance animations, and "MUST use Tailwind CSS defaults unless custom values already exist" (ours exist: the
`DESIGN.md` tokens, which win).

## Scan

Sentry `skill-scanner` (`getsentry/skills` @ `e94f22214528d69899d09c627b3315ddc3544816`, `scripts/scan_skill.py`
run with `uv`), plus its same checks applied to every file in the folder: 0 findings on 2026-11-08. Its URL list
flags one link (base-ui.com docs); none is fetched.
