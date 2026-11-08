# Sources: web-interface-guidelines

- **Repo:** https://github.com/vercel-labs/web-interface-guidelines
- **Commit:** `434b7f91364665f2f733b310ec54809bf8f37937` (main, 2026-10-05). `command.md` last changed in `4ecfb9f`
  (2026-10-05).
- **Licence:** MIT (`LICENSE`, copied from the repo root, beside this file)
- **Vendored:** 2026-11-08 by Athena (task #68). Zeus approved the UI start set on 2026-11-08. Adapted (§21): pinned
  copy, never run `install.sh`; sentence case; WCAG 2.2 AA as the bar.
- **Discovery:** the skill lives directly at `.claude/skills/web-interface-guidelines/` (Claude Code finds skills one level deep; no symlinks, no `vendor/` folder).

## Paths copied

| Upstream | Here | Changed |
|---|---|---|
| `command.md` | `SKILL.md` | yes |
| `LICENSE` | `LICENSE` | no |

## Left out

- `install.sh`: never run, not copied. It `curl`s `command.md` from the moving `main` branch into the home folders of
  every agent it finds (`~/.claude/commands/`, Amp, Cursor, OpenCode, Antigravity, Gemini CLI) and appends it to
  Windsurf's global rules.
- `AGENTS.md` and `README.md`: the long form of the same guidelines, with Vercel's brand copywriting rules and
  "prefer APCA over WCAG 2" (§21 picked WCAG 2.2 AA). The README also points to `npx skills add` of
  vercel-labs/agent-skills `web-design-guidelines`, which fetches unpinned rules on every run (research: skip).

## Changes we made

1. **Wrapped as a skill:** upstream is a slash command. Front matter: added `name: web-interface-guidelines` and our
   own `description`; kept `argument-hint` and the `$ARGUMENTS` line.
2. A LetZeusPost note under the title: the source and commit, what changed, never run `install.sh` or fetch the
   guidelines from the web, and "with no files named, review the files you were given" (for agents that read the
   file instead of running it as a command).
3. **WCAG 2.2 AA as the bar:** two lines added at the end of "Accessibility", marked "LetZeusPost": contrast with the
   WCAG 2 ratio, not APCA (text 4.5:1, large text 3:1, UI parts, focus indicators and meaningful graphics 3:1; 1.4.3,
   1.4.11), and pointer targets of at least 24×24 CSS px or spaced (2.5.8).
4. **Sentence case:** "Content & Copy": "Title Case for headings/buttons (Chicago style)" → "Sentence case for
   headings, buttons and labels" (marked "LetZeusPost; upstream: Title Case"), and the example label "Save API Key" →
   "Save API key".

## Review notes

Every file in the repo read in full (`install.sh` as data only). `command.md` is text: no hooks, scripts or network
calls. Upstream's stance worth knowing: "`&` over 'and' where space-constrained", "Placeholders end with `…`",
"`autocomplete="off"` on non-auth fields", curly quotes and `…` in UI copy, and `file:line` terse findings with "No
preamble". Where it differs from `DESIGN.md`, §05 or §21, those win.

## Scan

Sentry `skill-scanner` (`getsentry/skills` @ `e94f22214528d69899d09c627b3315ddc3544816`, `scripts/scan_skill.py`
run with `uv`), plus its same checks applied to every file in the folder: 0 findings on 2026-11-08. No URLs in
`SKILL.md`.
