# Section 21: AI design workflow (Approved 2026-11-06, revised 2026-11-06)

> **Stack:** decided in [§13](13-architecture.md) (approved 2026-11-06). Where this doc differs, §13 wins.

**Goal:** what agents build looks like the approved design, and stays that way.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| How does design stay on track? | Mockups → tokens → visual tests; a changed screenshot of an approved screen waits for Zeus |
| Use outside design skills? | Yes: researched and rated (below and in [research/skills.md](research/skills.md)) |

## Spec

### Pipeline

1. **Source of truth:** the [§05](05-app-design.md) mockups once Zeus approves them. Screenshots of every
   screen × state × theme go to `docs/design/mockups/`, and the mockup HTML is archived.
2. **Tokens:** the §05 design system is written as **`DESIGN.md`** in the
   [google-labs-code/design.md](https://github.com/google-labs-code/design.md) format (tokens + guidance). CI runs
   `design.md lint` (contrast, broken references) and `diff` (regressions), and `export` produces the Tailwind tokens.
   Changing `DESIGN.md` is a `sensitive` change. `packages/ui` holds the generated CSS variables (light and dark) and a Tailwind
   preset. Lint rules ban raw colors and arbitrary values outside the tokens, any icon set other than Lucide, and any
   interface font other than Inter. All interface text lives in `apps/web/messages/en.json`.
3. **Components:** shadcn/ui in `packages/ui`, each shown in a component gallery (Storybook) in all its states
   (default, hover, focus, disabled, empty, loading, error) in light and dark.
4. **Screens:** built only from tokens and gallery components.

### Visual tests

- Every [§04](04-flows-and-screens.md) screen × its states (empty, loading, error, filled) × light/dark at 1440 px.
  The client review page and the phone views also run at 390 px. Seeded sample data ("Northwind Social" and 3
  brands). Gallery components get screenshot tests too.
- They run in the CI Docker image (same fonts every time). Baselines are committed under `tests/visual/`.
- Changing the baseline of an **approved** screen is a `sensitive` change (Zeus looks at the before/after/diff images).
  A new screen's first baseline is `routine`: Iris compares it with the mockup.
- Accessibility on every screen: axe with no serious or critical issues, keyboard paths through the main journeys,
  visible focus, reduced motion respected, WCAG 2.2 AA contrast.

### Design review (Iris)

Iris joins at the first UI milestone. She compares the PR's screenshots with the approved mockups and tokens: layout, spacing, hierarchy, all states present,
contrast, and the interface voice (wit only in loading and empty states). Findings that break the approved design
block the PR. Iris's skills are listed in [19](19-build-team-and-workflow.md#skills-per-agent).

### Posts' own design

The look presets and layouts that render clients' posts are approved designs too. Their golden renders (§08, §17) are
`sensitive` to change, and Iris reviews them. Post rules start from the studio's `social-posts` skill, the
`ig-carousel` structure rules (6–10 slides, cover ≤ 6 words, ≤ 25 words a slide, type ≥ 32 px at 1080) and our own
`bangla-typography` skill.

### Design changes

Zeus asks for a change → Athena updates the §05 mockups → Zeus approves → a build task that includes the new baselines.

### Outside design skills (picked from the research)

| Skill | Licence | Verdict |
|---|---|---|
| DESIGN.md spec + CLI (google-labs-code/design.md) | Apache-2.0 | **Use**: the token spec, lint, diff, export |
| shadcn skill (shadcn-ui/ui `skills/shadcn`) | MIT | **Use**: pin the CLI version; Next.js; lucide |
| baseline-ui + fixing-accessibility (ibelick/ui-skills) | MIT | **Use as-is**: "one accent per view", no gradients, no unrequested animation |
| Web Interface Guidelines (vercel-labs/web-interface-guidelines `command.md`) | MIT | **Adapt**: pinned copy, never run `install.sh`; sentence case; WCAG 2.2 AA as the bar |
| frontend-design (anthropics/skills) | Apache-2.0 | **Adapt**: remove the "take aesthetic risk" persona; bind to `DESIGN.md` |
| design-review agent (OneRedOak/claude-code-workflows) | MIT | **Adapt**: read-only; mockup diff; light + dark; axe; WCAG 2.2 |
| impeccable audit + critique (pbakaus/impeccable) | Apache-2.0 | **Adapt**: rubric files only; no binary, telemetry or hooks |
| make-interfaces-feel-better (jakubkrehel) | MIT | **Use**; our tokens win where it prefers shadows |
| emil-design-eng + review-animations (emilkowalski/skills) | MIT | **Adapt**: remove its canned first reply |
| accessibility (addyosmani/web-quality-skills) | MIT | **Use as-is** |
| playwright-cli (microsoft/playwright-cli) | Apache-2.0 | **Use** (pinned) |
| Storybook MCP `test-run` (storybookjs/mcp) | MIT | **Use** if Storybook ≥ 10.5 |
| ig-carousel (Jakeschincariol/instagram-agent-skill) | MIT | **Adapt** into the §07 rules and prompts |
| indic-typography (Siyana158/dev-craft) | MIT | **Adapt** into our `bangla-typography` |

**Start set (first UI milestone):** DESIGN.md, shadcn, baseline-ui, our `design-system`, Web Interface Guidelines
(Iris), the adapted design-review agent (Iris), addyosmani accessibility, playwright-cli. The rest of the table is
added only when a review keeps finding the same problem; ig-carousel and indic-typography feed §07 and our
`bangla-typography`. Reference-only and skipped items, and the reasons, are in
[research/skills.md](research/skills.md#design-and-ui).

### Gaps we fill ourselves

- Comparing PR screenshots with approved mockups (Playwright `toHaveScreenshot` baselines).
- Text fit and safe zones on fixed-size post canvases. The studio renderer's fit report is the base.
- Contrast for text over photos. axe can't check a PNG, so we run axe on the HTML before the screenshot and add a
  pixel-sampled contrast check.
- A Bangla typography standard with numbers (W3C's Bengali layout draft is mostly "tbd"), to be tested on our renders.

### Design finding that changes §05

Gold `#F5B301` on white is about **1.9:1**, which fails even the 3:1 minimum for UI parts. In light mode, focus
rings, borders and selected outlines use ink or deep amber; gold is only a fill with near-black text on it
(about 11:1). Dark mode can use gold for rings.

## Not in the MVP

Figma (code-first was chosen; the Figma connector can be added later).

## Done when (milestones H0 + M0)

- The token lint fails on a raw color, and `design.md lint` fails on a contrast pair under AA.
- A visual test fails on a 4 px shift.
- axe runs in CI on every screen.
- The component gallery builds as a CI artifact.
- Iris reviews a sample UI PR.

## Depends on

[04](04-flows-and-screens.md), [05](05-app-design.md), §13.
