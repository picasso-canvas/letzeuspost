# Section 5: App design (Approved 2026-11-07)

**Goal:** the look of the LetZeusPost app itself, shown as clickable mockups that Zeus approves before any product code.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| How should the app feel? | A **calm pro tool** (Linear/Notion-like: neutral surfaces, lots of space; the clients' posts are the stars) |
| Accent color? | **Thunderbolt gold** |
| Light or dark? | **Both**, following the system, with a switch in Account settings |
| How much Zeus personality? | A **subtle bolt + witty copy**: humor only in loading and empty states; errors and actions stay plain |
| Mockups approved? | **Yes, 2026-11-07**, as they are (mockups v1.13): "The app design looks good to me; if anything needs improvement we'll do it later." |
| How to review the designs? | **Clickable HTML mockups** with sample data |

## Spec

### Design system

- **Color:** neutral stone/zinc scale for surfaces, borders and text; near-black ink. Gold (around `#F5B301`) as a
  *fill* for primary buttons (near-black text on gold), the selected state, focus rings, the logo and progress. Gold
  text on white fails contrast, so text accents in light mode use a deep amber (around `#9A6700`); dark mode uses gold
  directly. Every color pair is checked against WCAG AA.
- **Gold contrast (finding, 2026-11-06, [§21](21-ai-design-workflow.md)):** gold `#F5B301` on white is about
  **1.9:1**, which fails even the 3:1 minimum for UI parts. In light mode, **focus rings, borders and selected
  outlines use ink or deep amber**; gold is only a fill with near-black text on it (about 9.4:1). Dark mode can use
  gold for rings. The design system is written as `DESIGN.md` and its contrast is checked by `design.md lint`.
- **Status colors:** Generating (slate, animated) · Needs fix (red) · In review (gold) · With client (violet) ·
  Approved (green) · Exported (gray). QC: pass (green) / warn (amber) / fail (red). Each status also has an icon, not
  only a color.
- **Brand colors in the app:** each client brand appears with its own primary color (calendar chips, tiles).
- **Type:** Inter for the interface (OFL; 14 px base, 13 px meta, tabular numbers in meters and counters). Post
  previews use each brand's own fonts.
- **Shape and space:** 8 px grid, radius 8 (controls) / 12 (cards), borders instead of heavy shadows, comfortable density.
- **Components** (shadcn/ui + Lucide icons): sidebar, top bar, ⌘K command menu, buttons (primary gold / secondary /
  ghost / destructive), inputs, tabs, dialog, side sheet, dropdown, toast, status badge, avatar, month/week calendar,
  post card, slide thumbnail, batch stepper, live progress row, usage meter, empty state, skeleton, comment thread,
  caption box with character counter, image picker, color and font pickers, size tabs.
- **Motion:** 150–200 ms, a shimmer on generating cards, and nothing moves when the system asks for reduced motion.
- **Voice of the interface:** short and plain. Witty lines only while waiting or when a screen is empty, e.g.
  "Zeus is writing your captions…", "Forging slides…", "Nothing waiting. Even gods take breaks."
- **Logo:** a placeholder wordmark with a small bolt until Section 3 finalizes it.

### The mockups (not product code; thrown away once approved)

A private, clickable web page with sample data, built on the [Section 4](04-flows-and-screens.md) screens:
- **Sample agency** "Northwind Social" with 3 fictional client brands in different looks: a Dhaka café (EN + BN),
  a US fitness studio, and a UK dental clinic.
- **Screens:** Welcome (guided first batch) · Inbox · Brands · New brand (URL → reading the site → check the kit) ·
  Brand kit (Voice, Look) · Batch ideas stage (calendar with holiday chips) · Batch posts stage (calendar ⇄ grid, live
  progress) · Post editor (slides, size tabs, Slide / Captions / Checks / History / Comments, EN ⇄ BN, AI rewrite) ·
  Export dialog · Client review in a phone frame · Settings: Plan & usage.
- A light/dark toggle, and real-looking post previews (Bangla included) in the brands' looks.
- Zeus clicks through, comments, and we iterate until it's approved. Approved screenshots and notes are then added
  to this doc.

### Mockups v1 (2026-11-06)

**Link:** https://claude.ai/artifact/L47yVDF9nHEdrnYKaPHiDe (private to Zeus; shared from the page's Share menu).
Screens: welcome (guided first batch), inbox (with its empty state), all-brands calendar, brands, new brand from a
website, brand kit (identity, voice, look, rules, publishing, holidays), batch ideas stage with holiday chips,
batch posts (grid and calendar, live generation progress, multi-select), post editor (slides, EN ⇄ বাংলা, 4:5 and
9:16 with safe areas, slide / captions / checks / history / comments, AI rewrite), export dialog, client review on a
phone, settings: plan & usage. Light and dark. Sample agency "Northwind Social" with Golpo Café (Dhaka, Playful),
Ironline Studio (Austin, Bold) and Brightwell Dental (Leeds, Clean).

**Approved 2026-11-07** (v1.13): https://claude.ai/artifact/L47yVDF9nHEdrnYKaPHiDe, source archived at
`docs/design/mockups/v1/index.html`. Screenshots of each screen are taken with Playwright in M0, when the component
gallery and the visual baselines start (§21), and saved to `docs/design/mockups/v1/screens/`. Improvements found later
go through Iris's design review and a normal PR.

## Not in the MVP

A marketing website, the email designs (they follow this system and are planned in Section 11), and a Bangla interface.

## Done when

- [x] Zeus approves the mockups, and their link is recorded here (2026-11-07).
- [ ] Screenshots of each screen are saved (M0, with the component gallery).

## Depends on

[Section 1](01-product-spec.md), [Section 4](04-flows-and-screens.md); the logo comes from Section 3.
