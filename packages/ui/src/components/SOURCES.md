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
| `label.tsx` | `@shadcn/label` | `cn` import only |
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
6. **No gold text or outline in light mode:** `button.tsx` `link`: `text-primary` (gold) → `text-foreground` (ink),
   always underlined, `dark:text-primary`. `field.tsx` `FieldLabel` selected border `border-primary/30` →
   `border-foreground`, `dark:border-primary`; `FieldDescription` link hover `text-primary` → `text-foreground`,
   `dark:text-primary`.
7. **Reduced motion:** `button.tsx` `transition-all` → `transition`, plus `motion-reduce:transition-none` (and on
   `input.tsx`); the pressed nudge (`translate-y-px`) only under `motion-safe:`.
8. **8 px grid:** `field.tsx` `FieldGroup` `gap-7` (28 px) → `gap-6` (24 px).

Not changed here, for #74: the `outline` and `link` button variants, which §05's set (primary gold, secondary, ghost,
destructive) doesn't name. Colours, radius and fonts come from the tokens `DESIGN.md` generates (#70); the stylesheet
is #74's.
