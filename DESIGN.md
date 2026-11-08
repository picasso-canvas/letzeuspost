---
version: alpha
name: LetZeusPost
description: >-
  The LetZeusPost app (§05, approved mockup v1.13): a calm pro tool on neutral stone surfaces, near-black ink, and one
  gold accent used as a fill. Every colour has a light value and a dark partner named `<name>-dark`.
colors:
  # Light (the names match shadcn/ui's theme variables, which packages/ui's components use)
  background: "#F7F6F4"
  foreground: "#1C1A17"
  card: "#FFFFFF"
  card-foreground: "#1C1A17"
  popover: "#FFFFFF"
  popover-foreground: "#1C1A17"
  primary: "#F5B301"
  primary-foreground: "#1C1A17"
  secondary: "#F1F0EC"
  secondary-foreground: "#1C1A17"
  muted: "#F1F0EC"
  muted-foreground: "#5B5750"
  accent: "#F1F0EC"
  accent-foreground: "#1C1A17"
  destructive: "#C2261F"
  border: "#E4E2DD"
  border-strong: "#D3D0C9"
  input: "#D3D0C9"
  ring: "#1C1A17"
  faint: "#8E8A82"
  accent-text: "#8A5D00"
  status-generating: "#5C6B7E"
  status-needs-fix: "#C2261F"
  status-in-review: "#8A5D00"
  status-with-client: "#6D3FD1"
  status-approved: "#13773D"
  status-exported: "#6F6A62"
  qc-pass: "#13773D"
  qc-warn: "#A15C00"
  qc-fail: "#C2261F"
  # Dark
  background-dark: "#11100E"
  foreground-dark: "#F3F1EC"
  card-dark: "#191815"
  card-foreground-dark: "#F3F1EC"
  popover-dark: "#191815"
  popover-foreground-dark: "#F3F1EC"
  primary-dark: "#F5B301"
  primary-foreground-dark: "#1C1A17"
  secondary-dark: "#22201C"
  secondary-foreground-dark: "#F3F1EC"
  muted-dark: "#22201C"
  muted-foreground-dark: "#B3AEA4"
  accent-dark: "#22201C"
  accent-foreground-dark: "#F3F1EC"
  destructive-dark: "#F87171"
  border-dark: "#2F2C27"
  border-strong-dark: "#3E3A33"
  input-dark: "#3E3A33"
  ring-dark: "#F5B301"
  faint-dark: "#8C877E"
  accent-text-dark: "#F5B301"
  status-generating-dark: "#94A3B8"
  status-needs-fix-dark: "#F87171"
  status-in-review-dark: "#F5B301"
  status-with-client-dark: "#B39DFA"
  status-approved-dark: "#4ADE80"
  status-exported-dark: "#A8A29E"
  qc-pass-dark: "#4ADE80"
  qc-warn-dark: "#FBBF24"
  qc-fail-dark: "#F87171"
typography:
  body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  h1:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: 650
    letterSpacing: -0.01em
  h2:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 650
    letterSpacing: -0.01em
  h3:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 600
  eyebrow:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 600
    letterSpacing: 0.06em
  numbers:
    fontFamily: Inter
    fontSize: 14px
    fontFeature: '"tnum"'
rounded:
  md: 8px
  lg: 12px
spacing:
  grid: 8px
components:
  # Every text colour on every surface it is used on, light then dark: `design.md lint` checks each pair (WCAG AA).
  page-text:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
  page-text-muted:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
  card-text:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
  card-text-muted:
    backgroundColor: "{colors.card}"
    textColor: "{colors.muted-foreground}"
  card-text-faint:
    backgroundColor: "{colors.card}"
    textColor: "{colors.faint}"
  card-text-accent:
    backgroundColor: "{colors.card}"
    textColor: "{colors.accent-text}"
  card-text-destructive:
    backgroundColor: "{colors.card}"
    textColor: "{colors.destructive}"
  popover-text:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.popover-foreground}"
  sidebar-text:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
  sidebar-text-muted:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
  sidebar-text-faint:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.faint}"
  menu-item-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: 36px
  status-generating:
    backgroundColor: "{colors.card}"
    textColor: "{colors.status-generating}"
  status-needs-fix:
    backgroundColor: "{colors.card}"
    textColor: "{colors.status-needs-fix}"
  status-in-review:
    backgroundColor: "{colors.card}"
    textColor: "{colors.status-in-review}"
  status-with-client:
    backgroundColor: "{colors.card}"
    textColor: "{colors.status-with-client}"
  status-approved:
    backgroundColor: "{colors.card}"
    textColor: "{colors.status-approved}"
  status-exported:
    backgroundColor: "{colors.card}"
    textColor: "{colors.status-exported}"
  qc-pass:
    backgroundColor: "{colors.card}"
    textColor: "{colors.qc-pass}"
  qc-warn:
    backgroundColor: "{colors.card}"
    textColor: "{colors.qc-warn}"
  qc-fail:
    backgroundColor: "{colors.card}"
    textColor: "{colors.qc-fail}"
  page-text-dark:
    backgroundColor: "{colors.background-dark}"
    textColor: "{colors.foreground-dark}"
  page-text-muted-dark:
    backgroundColor: "{colors.background-dark}"
    textColor: "{colors.muted-foreground-dark}"
  card-text-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.card-foreground-dark}"
  card-text-muted-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.muted-foreground-dark}"
  card-text-faint-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.faint-dark}"
  card-text-accent-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.accent-text-dark}"
  card-text-destructive-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.destructive-dark}"
  popover-text-dark:
    backgroundColor: "{colors.popover-dark}"
    textColor: "{colors.popover-foreground-dark}"
  sidebar-text-dark:
    backgroundColor: "{colors.secondary-dark}"
    textColor: "{colors.secondary-foreground-dark}"
  sidebar-text-muted-dark:
    backgroundColor: "{colors.muted-dark}"
    textColor: "{colors.muted-foreground-dark}"
  sidebar-text-faint-dark:
    backgroundColor: "{colors.muted-dark}"
    textColor: "{colors.faint-dark}"
  menu-item-hover-dark:
    backgroundColor: "{colors.accent-dark}"
    textColor: "{colors.accent-foreground-dark}"
  button-primary-dark:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.primary-foreground-dark}"
    rounded: "{rounded.md}"
    height: 36px
  status-generating-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.status-generating-dark}"
  status-needs-fix-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.status-needs-fix-dark}"
  status-in-review-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.status-in-review-dark}"
  status-with-client-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.status-with-client-dark}"
  status-approved-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.status-approved-dark}"
  status-exported-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.status-exported-dark}"
  qc-pass-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.qc-pass-dark}"
  qc-warn-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.qc-warn-dark}"
  qc-fail-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.qc-fail-dark}"
---

## Overview

LetZeusPost is a calm pro tool for agencies ([§05](docs/plan/05-app-design.md#design-system)). Neutral stone surfaces
and near-black ink carry the interface; one gold accent is used as a fill. The clients' posts carry the colour, so the
app around them stays quiet. The approved mockup (`docs/design/mockups/v1/`, v1.13) is the source of truth; this file
writes its tokens down ([§21](docs/plan/21-ai-design-workflow.md#pipeline)).

Light and dark are both first-class: the app follows the system, with a switch in Account settings. Every colour below
has a light value and a dark partner named `<name>-dark`; `packages/ui/src/tokens/` turns the pairs into CSS variables
that switch under `.dark`.

## Colors

- **Background / card / popover:** stone `#F7F6F4` behind white cards; dark `#11100E` behind `#191815`.
- **Foreground (ink):** near-black `#1C1A17` for text and core marks; dark `#F3F1EC`.
- **Muted foreground:** `#5B5750` for secondary text (dark `#B3AEA4`).
- **Primary (gold) `#F5B301`:** a fill only, always with near-black text on it (`primary-foreground`, about 9.4:1):
  primary buttons, the selected state, the logo and progress. Gold text on white is about 1.9:1, so **gold is never
  text, a border, a ring or an outline in light mode**.
- **Accent text (deep amber) `#8A5D00`:** text accents in light mode (the mockup's `--accent-text`); dark mode uses
  gold directly.
- **Ring (focus):** ink in light mode, gold in dark (the mockup's `--focus`). Borders and selected outlines in light
  mode use ink or deep amber.
- **Border / border-strong / input:** hairlines `#E4E2DD`, stronger `#D3D0C9` for controls.
- **Status** (each also has an icon, never colour alone): Generating (slate), Needs fix (red), In review (gold family:
  deep amber text in light), With client (violet), Approved (green), Exported (grey). **QC:** pass (green), warn
  (amber), fail (red).
- **Faint** `#6F6A62` (dark `#8C877E`): the quietest text grey, for eyebrows, counts and small meta. Darkened from the
  mockup's `#8E8A82` / `#847F76` so it passes AA as text (Zeus, 2026-11-08, #70).
- Each client brand appears with its own primary colour (calendar chips, tiles); those come from the brand kit, not
  from this file.

## Typography

Inter is the only interface font (self-hosted). 14 px base, 13 px meta; headings 22 / 16 / 14 px at 650–600 weight
with slight negative tracking; eyebrows 11 px, 600, uppercase, wide tracking; tabular numbers in meters, counters and
tables. Post previews use each brand's own fonts, not these.

## Layout

An 8 px grid (`spacing.grid`; in Tailwind, steps of 2: `gap-2`, `p-4`, `gap-6`). Comfortable density: desktop-first (best at 1280 px and up, mockups at 1440 px), the client review page
mobile-first (390 px). The app frame is a 228 px sidebar beside the content.

## Elevation & Depth

Borders instead of heavy shadows. One soft shadow lifts the app frame and menus off the page (light: two layers at 6%
and 8% ink; dark: 40% and 35% black). Nothing else is raised.

## Shapes

Radius 8 px on controls (`md`), 12 px on cards (`lg`). Pills (counts, tags) are fully rounded.

## Components

shadcn/ui components in `packages/ui`, Base UI underneath, Lucide icons only, each in the component gallery in every
state, light and dark. Buttons: primary gold, secondary, ghost, destructive, about 36 px tall. Focus is a solid 2 px
outline in `ring` with a 2 px gap, never a see-through ring. Motion is 150–200 ms, a shimmer on generating cards, and
nothing moves under reduced motion.

## Do's and Don'ts

- Do use gold only as a fill with near-black text on it; don't use gold for text, borders, rings or outlines in light
  mode.
- Do pair every status colour with its icon.
- Do shorten the words when text doesn't fit; don't shrink the type or the spacing.
- Do use these tokens through `packages/ui`; don't write a raw colour, an arbitrary value, another icon set or another
  font (the lint refuses them).
- Don't animate anything when the system asks for reduced motion.
