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
motion, with the mockup's own bar (screen picker, theme switch) hidden.

The source has one change since approval: the faint grey (`--faint`) is darkened so it passes WCAG AA as text (light
`#8E8A82` → `#6F6A62`, dark `#847F76` → `#8C877E`; Zeus, 2026-11-08, #70). The published page still shows the old
grey until it's republished; the screenshots and `DESIGN.md` use the new one.

These are the approved design for reference and for Iris's review. They aren't visual-test baselines: those are
rendered in CI and live in `tests/visual/` (§21, Q11).
