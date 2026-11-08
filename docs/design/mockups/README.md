# Mockups (Section 5)

Clickable mockups of the LetZeusPost app. They are planning material, not product code.

| Version | Date | Link | Status |
|---|---|---|---|
| v1 | 2026-11-06 | https://claude.ai/artifact/L47yVDF9nHEdrnYKaPHiDe (private to Zeus) | **approved** as v1.13 (Zeus, 2026-11-07) |

`v1/index.html` is the published page's source. Edit it and republish to the same link; when a version is approved,
add screenshots of each screen next to it.

## v1 screenshots

`v1/screens/` holds every screen in the mockup's screen list, light and dark: `<nn>-<screen>-<theme>.png`, numbered
in the list's order. They were taken on 2026-11-08 (#70) with Playwright in Chrome at 1440 × 900, full page, reduced
motion, with the mockup's own bar (screen picker, theme switch) hidden. `12-review-390-light.png` is the client
review page at phone width (390 px), full length, with the phone's inner scroll opened up.

## Changes since v1.13 was approved

Zeus approved each of these on 2026-11-08 (#70). They are in the source, the screenshots and `DESIGN.md`, which are
the record; the published page stays at v1.13 as first approved (Zeus, 2026-11-08):
- **Faint grey** (`--faint`) darkened so it passes WCAG AA as text: light `#8E8A82` → `#6F6A62`, dark `#847F76` →
  `#8C877E` ([decision](https://github.com/picasso-canvas/letzeuspost/issues/70#issuecomment-6722863139)).
- **Input border** (new `--input`, on text fields and selects) at 3:1 for WCAG 1.4.11: light `#8A857D`, dark
  `#706B63`, where they used `--border-strong` (`#D3D0C9` / `#3E3A33`, 1.5:1)
  ([decision](https://github.com/picasso-canvas/letzeuspost/issues/70#issuecomment-6723593363)).
- **The client review page in dark** follows the phone's setting, with the app's tokens. The mockup draws the phone
  in light only, so it has no dark reference; Iris checks the dark version when that page is built (same decision).

Known for later: the post editor's tab row cuts its last tab ("Comments") at 1440 px (`10-editor-*.png`). The
editor's build task shortens the labels or lets the row scroll; it doesn't shrink the type (§01).

These are the approved design for reference and for Iris's review. They aren't visual-test baselines: those are
rendered in CI and live in `tests/visual/` (§21, Q11).
