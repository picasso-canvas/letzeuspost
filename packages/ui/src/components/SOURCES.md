# Sources: shadcn/ui components

Added by Athena with the pinned CLI (`pnpm exec shadcn add …` in `packages/ui`, `shadcn@4.23.0`) from the official
`@shadcn` registry, style `base-vega` (Base UI), on 2026-11-08 (#107). shadcn/ui is MIT (© shadcn). Builders don't
run the CLI; a component that isn't here is a `needs-zeus` item that Athena adds (Zeus, 2026-11-08).

The registry's components import `cn` from the `cn` package (shadcn's, MIT, pinned `0.5.2`, no dependencies or install
scripts). Every file was reformatted by the repo's Prettier.

| File | Registry item | Changed by us |
|---|---|---|
| `button.tsx` | `@shadcn/button` | yes |
| `input.tsx` | `@shadcn/input` | yes |
| `label.tsx` | `@shadcn/label` | no |
| `field.tsx` | `@shadcn/field` | yes |
| `separator.tsx` | `@shadcn/separator` (needed by `field`) | no |

## Changes we made

`lzp/tokens-only` refuses arbitrary values (§21), so each one became a token class:

1. `button.tsx` `secondary`: `hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]` →
   `hover:bg-secondary/80`.
2. `button.tsx` sizes `xs`, `sm`, `icon-xs`, `icon-sm`: `rounded-[min(var(--radius-md),8px)]` and
   `rounded-[min(var(--radius-md),10px)]` → `rounded-md` (controls are radius 8, §05).
3. `input.tsx`: `transition-[color,box-shadow]` → `transition` (it still covers colour and the focus ring's shadow).
4. `field.tsx` `FieldError`: `uniqueErrors?.length == 1` → `uniqueErrors.length === 1` (the array is never nullish;
   `@typescript-eslint/no-unnecessary-condition`).

Colours, radius and fonts come from the tokens `DESIGN.md` generates (#70); the stylesheet is #74's.
