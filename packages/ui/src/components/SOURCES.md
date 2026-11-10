# Sources: shadcn/ui components

Added by Athena with the pinned CLI (`pnpm exec shadcn add …` in `packages/ui`, `shadcn@4.23.0`) from the official
`@shadcn` registry, style `base-vega` (Base UI), on 2026-11-08 (#107). shadcn/ui is MIT (© shadcn). Builders don't
run the CLI; a component that isn't here is a `needs-zeus` item that Athena adds (Zeus, 2026-11-08).

The registry's components import `cn` from the `cn` npm package; here they import it from `@lzp/ui/lib/utils`
(`src/lib/utils.ts`: `clsx` + `tailwind-merge`, shadcn's long-standing helper), and the package isn't added. Every file
was reformatted by the repo's Prettier.

| File | Registry item | Changed by us |
|---|---|---|
| `button.tsx` | `@shadcn/button` | yes |
| `input.tsx` | `@shadcn/input` | yes |
| `label.tsx` | `@shadcn/label` | `cn` import only (`'use client'` kept) |
| `field.tsx` | `@shadcn/field` | yes |
| `separator.tsx` | `@shadcn/separator` (needed by `field`) | `cn` import only |

## Changes we made

`lzp/tokens-only` refuses arbitrary values (§21), so each one became a token class:

1. `button.tsx` `secondary`: `hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]` →
   `hover:bg-secondary/80`.
2. `button.tsx` sizes `xs`, `sm`, `icon-xs`, `icon-sm`: `rounded-[min(var(--radius-md),8px)]` and
   `rounded-[min(var(--radius-md),10px)]` → `rounded-md` (controls are radius 8, §05).
3. `input.tsx`: `transition-[color,box-shadow]` → `transition`. That also animates opacity, transform and filters for
   150 ms; the input changes none of them, and change 7 turns transitions off under reduced motion.
4. `field.tsx` `FieldError`: `uniqueErrors?.length == 1` → `uniqueErrors.length === 1` (the array is never nullish;
   `@typescript-eslint/no-unnecessary-condition`).

To the approved design (§05, §21 and the v1 mockup; Iris on #108):

5. **Focus** (`button.tsx`, `input.tsx`, `field.tsx` choice cards): the 3 px ring at 50% (`ring-3 ring-ring/50`) → a
   solid 2 px outline with a 2 px gap in the `ring` token (`outline-2 outline-offset-2 outline-solid outline-ring`), as
   the mockup draws it. `button.tsx` `destructive` loses its own focus ring colours. #70's tokens must make `ring` ink
   in light mode and gold in dark.
6. **No gold text or outline in light mode:** `field.tsx` `FieldLabel` selected border `border-primary/30` →
   `border-foreground`, `dark:border-primary`; `FieldDescription` link hover `text-primary` → `text-foreground`,
   `dark:text-primary`.
7. **Reduced motion:** `button.tsx` `transition-all` → `transition`, plus `motion-reduce:transition-none` (and on
   `input.tsx`); the pressed nudge (`translate-y-px`) only under `motion-safe:`.
8. **8 px grid:** `field.tsx` `FieldGroup` `gap-7` (28 px) → `gap-6` (24 px).

To the mockup and WCAG AA (#74, with `DESIGN.md`'s tokens in place; `button.contrast.test.ts` checks every variant's text
on its own fill, resting and hovered, in light and dark):

9. **Primary hover is the mockup's hover gold**, as its `.btn-gold:hover` is: `hover:bg-primary/80` →
   `hover:bg-primary-hover`, the `primary-hover` token from `DESIGN.md` (#123); no filter, no see-through gold.
10. **`secondary` is the mockup's plain button:** a strong border on the card colour, the surface tint on hover:
    `bg-secondary hover:bg-secondary/80` → `border-border-strong bg-card hover:bg-secondary` (and
    `aria-expanded:bg-secondary`, as before).
11. **`destructive`:** shadcn's soft red tint (`bg-destructive/10`, hover `/20`, dark `/20` and `/30`) puts
    `text-destructive` under AA when hovered (3.9:1 on the page in light, 4.2:1 in dark) and on a `secondary` surface
    even at rest (4.4:1 and 4.3:1), and the mockup has no destructive button. It is now the plain button of change 10
    with destructive text, and a solid red outline (Zeus, #74, 2026-11-09): `border-destructive bg-card
    text-destructive hover:bg-secondary aria-expanded:bg-secondary`. Every state passes 4.5:1 (§05: every colour pair
    passes AA).
12. **Four variants only:** `outline` and `link` are removed (Zeus, #74, 2026-11-09). §05's set is primary gold
    (`default`), secondary, ghost and destructive; a test fails on any other name.

`'use client'`: the files were first added with `components.json` `rsc: false`, so the CLI stripped the registry's
`'use client'` from `label.tsx` and `field.tsx` (`FieldError` uses `useMemo`). `rsc` is now `true`, both have it back
as the registry ships them, and a test checks that every component using a React hook has it (Argus on #108).

Colours, radius and fonts come from the tokens `DESIGN.md` generates (#70); the stylesheet that loads them is
`src/styles/globals.css` (#74).
