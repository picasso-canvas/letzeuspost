---
name: design-system
description: How LetZeusPost's interface is built and reviewed (from §05 and §21), with DESIGN.md tokens, shadcn/ui components and their gallery, every state in light and dark, WCAG 2.2 AA and plain copy, and what Iris checks. Use before building or changing any screen, component or interface text, and before handing over a task that touches the UI.
---

# LetZeusPost design system

The approved design is the [§05](../../../docs/plan/05-app-design.md#mockups-v1-2026-11-06) mockups (v1.13, approved
2026-11-07, source in `docs/design/mockups/v1/`). These rules come from §05 and
[§21](../../../docs/plan/21-ai-design-workflow.md); where this file and those docs differ, the docs win. Where they are
silent (a value, a state or a layout the mockups don't show), don't decide: the plan doesn't say, so write the
question and your options under `**needs-zeus:**` in `.lzp/pr.md` and stop that part.

Never change the approved design on your own. A change Zeus asks for goes through updated mockups and his approval
first, then a build task with new baselines ([§21](../../../docs/plan/21-ai-design-workflow.md#design-changes)).

## Tokens: `DESIGN.md`

- `DESIGN.md` (repo root, in the design.md format) holds every color, type, space, radius and motion value.
  `packages/ui` holds what it generates: CSS variables for light and dark, and a Tailwind preset
  ([§21](../../../docs/plan/21-ai-design-workflow.md#pipeline)). Use those tokens. Take values from `DESIGN.md`, never
  from this file or the "around" values in §05.
- Screens are built only from tokens and gallery components. `DESIGN.md` is written from §05 by its own M0 task;
  until it and the generated tokens exist, don't build on stand-in values.
- Changing `DESIGN.md` is `sensitive` and builder-protected
  ([§20](../../../docs/plan/20-builder-guardrails.md#2-claude-code-settings-committed-sensitive)). A token you need
  that isn't there is a `needs-zeus` item, never a one-off value in a component.
- `pnpm check` lint refuses raw colors and arbitrary values outside the tokens (`lzp/tokens-only`), any icon set but
  Lucide (`lzp/lucide-only`) and any interface font but Inter (`lzp/inter-only`). CI runs `design.md lint`
  (contrast, broken references) and `diff` (regressions).

## The look ([§05](../../../docs/plan/05-app-design.md#design-system))

- **A calm pro tool:** neutral stone/zinc surfaces, borders and text, near-black ink, lots of space; the clients'
  posts are the stars. One accent per view, no gradients, no animation nobody asked for (baseline-ui,
  [§21](../../../docs/plan/21-ai-design-workflow.md#outside-design-skills-picked-from-the-research)).
- **Gold is a fill:** primary buttons (near-black text on gold, about 9.4:1), the selected state, the logo, progress.
  Gold `#F5B301` on white is about 1.9:1, so **in light mode, focus rings, borders and selected outlines use ink or
  deep amber, and gold-family text uses deep amber.** Dark mode uses gold directly, rings included
  ([§21](../../../docs/plan/21-ai-design-workflow.md#design-finding-that-changes-05)).
- **Status:** Generating (slate, animated) · Needs fix (red) · In review (gold) · With client (violet) · Approved
  (green) · Exported (gray). QC: pass (green) / warn (amber) / fail (red). Each one has an icon too, never color alone.
- **Client brands** appear in their own primary color (calendar chips, tiles); post previews use the brand's own
  fonts. How text on a chip stays AA with any brand color: the plan doesn't say; write it under `needs-zeus`.
- **Type:** Inter, 14 px base, 13 px meta, tabular numbers in meters and counters.
- **Shape and space:** 8 px grid, radius 8 for controls and 12 for cards, borders instead of heavy shadows,
  comfortable density.
- **Motion:** 150–200 ms, a shimmer on generating cards, and nothing moves when the system asks for reduced motion.
- **Logo:** the final files in `docs/design/logos/letzeuspost/`
  ([§03](../../../docs/plan/03-letzeuspost-brand.md#logo-a--crisp-strike)), which replace §05's placeholder.

## Components (`packages/ui`)

- shadcn/ui with Lucide icons. §05 names the set: sidebar, top bar, ⌘K command menu, buttons (primary gold /
  secondary / ghost / destructive), inputs, tabs, dialog, side sheet, dropdown, toast, status badge, avatar,
  month/week calendar, post card, slide thumbnail, batch stepper, live progress row, usage meter, empty state,
  skeleton, comment thread, caption box with character counter, image picker, color and font pickers, size tabs.
- Look in `packages/ui` and the gallery before making one. A screen that needs a new component adds it to
  `packages/ui` and the gallery first; screens never hold one-off components.
- Add shadcn components with the CLI at a pinned version, never `@latest`. A new dependency is a sensitive change:
  say why in the PR text.
- Every component is in the component gallery (Storybook) in all its states (default, hover, focus, disabled, empty,
  loading, error), in light and dark, with a screenshot test
  ([§21](../../../docs/plan/21-ai-design-workflow.md#visual-tests)).

## Screens and states

- Every [§04](../../../docs/plan/04-flows-and-screens.md#screens) screen has its empty, loading, error and filled
  states ([§04](../../../docs/plan/04-flows-and-screens.md#states-and-messages)):
  - **Empty:** one clear next action ("Nothing waiting. Make a calendar for ‹brand›").
  - **Loading:** skeletons; generation shows each post's steps, and the user can leave and come back.
  - **Error:** the reason and the way out (Retry, set up by hand, "Ask ‹agency› for a new link").
- Desktop-first (best at 1280 px and up, works on tablets). The client review page is mobile-first. On a phone, agency
  staff get the Inbox, the batch grid, a read-only post view, approve, comment and send to the client.
- Light and dark everywhere: the app follows the system, with a switch in Account settings.
- **When text doesn't fit, shorten the words; never shrink the layout**
  ([§01](../../../docs/plan/01-product-spec.md#product-principles-carried-over-from-the-editz-studio)). Fix an
  overflow in the copy, never with smaller type, tighter spacing or an arbitrary size.

## Interface copy

- All interface text lives in `apps/web/messages/en.json`. The interface is English only; posts are EN or BN.
- Short and plain, in sentence case
  ([§21](../../../docs/plan/21-ai-design-workflow.md#outside-design-skills-picked-from-the-research)).
- Wit only while waiting or on an empty screen: "Zeus is writing your captions…", "Forging slides…", "Nothing
  waiting. Even gods take breaks." Errors and actions stay plain: "This photo is too small for 9:16. Pick another or
  crop differently." No hype ("AI magic", "revolutionary") ([§03](../../../docs/plan/03-letzeuspost-brand.md#voice)).

## Accessibility: WCAG 2.2 AA

- Every color pair passes AA in both themes: 4.5:1 for body text, 3:1 for large text and UI parts (borders, focus
  rings, icons).
- On every screen: axe with no serious or critical issues, the main journeys by keyboard alone, visible focus, and
  reduced motion respected ([§17](../../../docs/plan/17-testing.md#the-layers)).
- Status, QC results and errors never rely on color alone.

## Visual tests and baselines ([§21](../../../docs/plan/21-ai-design-workflow.md#visual-tests))

- Playwright screenshots of every §04 screen × state × light and dark at 1440 px, plus the client review page and the
  phone views at 390 px, on the seeded sample data ("Northwind Social" and its 3 brands). They run in the CI Docker
  image; baselines live under `tests/visual/`.
- A new screen's first baseline is `routine`: Iris compares it with the mockup. Changing an **approved** screen's
  baseline is `sensitive` and builder-protected (`tests/visual/approved/**`); Zeus decides on the before, after and
  diff images. If your change moves an approved screen, stop and write it under `needs-zeus`.
- Post looks, layouts and their golden renders are approved designs too: `sensitive`, and Iris reviews them
  ([§21](../../../docs/plan/21-ai-design-workflow.md#posts-own-design)). Their rules are §07 and §08, not this file.

## What Iris checks

Iris reviews from a fresh context, read-only, on the batch PR into `main` when it touches UI; the merge gate needs
her pass ([§19](../../../docs/plan/19-build-team-and-workflow.md#the-merge-gate)). She doesn't run the app: she reads
the PR's files, diff, text and CI results, so every screen and state you changed needs its screenshot there. She
compares them with the approved mockups and tokens
([§21](../../../docs/plan/21-ai-design-workflow.md#design-review-iris)):

1. **Layout, spacing and hierarchy** match the mockup.
2. **Tokens only:** no raw color, arbitrary value, other icon set or font; no gold text, ring or outline in light mode.
3. **All states present:** empty, loading, error and filled, and each component's states, in light and dark.
4. **Contrast and accessibility:** WCAG 2.2 AA, axe clean, keyboard paths, visible focus, reduced motion.
5. **Interface voice:** plain, sentence case, wit only in loading and empty states.

A finding that breaks the approved design blocks the PR. **Before handing over** a UI task, add these five points to
the `**Self-review**` section of `.lzp/pr.md` ([review-checklist](../review-checklist/SKILL.md)), each with the
screenshots or command output that show it.
