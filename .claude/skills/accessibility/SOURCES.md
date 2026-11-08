# Sources: accessibility

- **Repo:** https://github.com/addyosmani/web-quality-skills
- **Commit:** `afa8da942115f2961fdbfa80807ea0b232ff6c00` (main, 2026-08-24). `skills/accessibility/` last changed in
  `c6b06ad` (2026-08-24).
- **Licence:** MIT (`LICENSE`, copied from the repo root, beside this file; `SKILL.md` front matter also says
  `license: MIT`)
- **Vendored:** 2026-11-08 by Athena (task #68). Zeus approved the UI start set on 2026-11-08. Used as-is (§21), except
  the changes below. Copied the skill folder only, never the repo's plugin manifests.
- **Discovery:** the skill lives directly at `.claude/skills/accessibility/` (Claude Code finds skills one level deep; no symlinks, no `vendor/` folder).
- **Pinned:** nothing to run from here. The automated check is the repo's pinned `@axe-core/playwright`; Lighthouse
  isn't used (change 3).

## Paths copied

From `skills/accessibility/`:

| File | Changed by us |
|---|---|
| `SKILL.md` | yes |
| `references/WCAG.md` | no |
| `references/A11Y-PATTERNS.md` | no |
| `LICENSE` (repo root) | no |

## Left out

Nothing from the skill folder. Not copied from the rest of the repo: the other skills (`best-practices`,
`core-web-vitals`, `performance`, `seo`, `web-quality-audit` with its `scripts/analyze.sh`), the plugin and extension
manifests (`.claude-plugin/`, `.agents/`, `codex/`, `gemini-extension.json`; the `codex/skills` and `.gemini/skills`
entries are symlinks to `skills/`), `CLAUDE.md` and `AGENTS.md`. `SKILL.md`'s "References" still links
`../web-quality-audit/SKILL.md`, which isn't here.

## Changes we made

1. `SKILL.md` "Testing checklist" → "Automated testing" code block:
   - `npx lighthouse https://example.com --only-categories=accessibility` (unpinned) → first pinned as
     `pnpm dlx lighthouse@13.6.0 …`, then removed (change 3);
   - `npm install @axe-core/cli -g` and `axe https://example.com` (a global, unpinned install) → `pnpm exec playwright
     test`, with a comment to use the repo's pinned `@axe-core/playwright` inside a Playwright test (§21: axe runs in CI
     on every screen).
2. `SKILL.md`: a LetZeusPost note under the title correcting upstream's large-text sizes (18 pt / 14 pt bold, that is
   24 px / about 18.66 px bold, not 18 px / 14 px), since builders follow the table (Athena, #68). The table itself is
   unchanged.
3. `SKILL.md` "Evidence-led audit workflow" step 1 and the fallback paragraph after it, and "Automated testing": the
   live Lighthouse audit (Chrome DevTools MCP `lighthouse_audit`), the "Lighthouse CLI or axe" fallback and the
   `pnpm dlx lighthouse@13.6.0` line → axe through the repo's pinned `@axe-core/playwright` in the screen's Playwright
   test, which CI runs on every screen (§21); don't install or download other audit tools. `pnpm dlx` pins only the
   top package: its dependencies resolve outside the lockfile, the licence check and the audits. Cerberus on #100.

## Review notes

Every copied file read in full. Text only: no hooks, scripts, install steps or telemetry. Things worth knowing:

- Upstream's "Evidence-led audit workflow" prefers a live Lighthouse audit through Chrome DevTools MCP
  (`lighthouse_audit`, `take_snapshot`). That MCP server isn't installed here (adding one needs Zeus's OK); our copy
  uses axe in Playwright instead (change 3). Step 3 still names `take_snapshot` as one way to read the accessibility
  tree; `playwright-cli`'s snapshot does the same here.
- **Upstream error:** the contrast table in `SKILL.md` says large text is "≥ 18px / ≥ 14px bold". WCAG 2.2 defines
  large text as 18 **pt** or 14 pt bold (24 px, or about 18.66 px bold), so 18–23 px regular text needs 4.5:1, not
  3:1. The table is left as upstream wrote it; the note at the top of `SKILL.md` (change 2) corrects it.
- `references/WCAG.md` and the target-size section match WCAG 2.2 AA (2.4.11, 2.5.7, 2.5.8, 3.3.8).

## Scan

Sentry `skill-scanner` (`getsentry/skills` @ `e94f22214528d69899d09c627b3315ddc3544816`, `scripts/scan_skill.py`
run with `uv`), plus its same checks applied to every file in the folder: 0 findings on 2026-11-08. Its URL list
flags 12 citation and example links (w3.org, dequeuniversity.com, deque.com, wave.webaim.org, nvaccess.org,
tpgi.com, `example.com` and `external.com` in examples); none is fetched.
