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
| `avatar.tsx` | `@shadcn/avatar` (#205) | yes |
| `dropdown-menu.tsx` | `@shadcn/dropdown-menu` (#205) | yes |
| `empty.tsx` | `@shadcn/empty` (#205) | yes |
| `skeleton.tsx` | `@shadcn/skeleton` (#205) | yes |
| `toast.tsx` | `@shadcn/toast` (#205; Base UI's toast, not `sonner`) | yes |
| `sidebar.tsx` | `@shadcn/sidebar` (#205) | yes |
| `sheet.tsx` | `@shadcn/sheet` (came with `sidebar`; kept as a general component) | yes |
| `tooltip.tsx` | `@shadcn/tooltip` (came with `sidebar`; kept as a general component) | yes |

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

## Added 2026-11-11 (#205)

Added by Athena for the app frame (#75), with the same pinned CLI and style. `toast` and `sidebar` were generated into
a scratch folder (`--path`) and only their new files copied in, so the CLI couldn't overwrite our `button`, `input`
and `separator`. The `cn` package the CLI added to `package.json` was taken out again; nothing new is a dependency.

13. **Arbitrary values, as named utilities:** the toast's stacking and swipe transforms, its CSS variables and its
    transition, the tooltip arrow's offset and the sidebar's outline rings are registry arbitrary values with no
    token to stand for them. Each is now a utility in `src/styles/components.css` (`z-toast`, `toast-vars`,
    `toast-stack`, `toast-transition`, `toast-expanded`, `toast-out`, `toast-swipe-{down,up,left,right}`,
    `h-toast-gap`, `tooltip-arrow-offset`, `shadow-sidebar-outline{,-strong}`, `shadow-sidebar-current`). The
    sidebar's collapsing widths, offsets and transitions went with its collapsing (change 28). They hold only `calc()` over the components' own variables and colour tokens, never a
    raw colour; `globals.test.ts` builds every one and checks.
14. **Values with a token:** `min-w-[96px]` → `min-w-24`; the sheet's `translate-{x,y}-[±2.5rem]` → `±translate-{x,y}-10`;
    `after:w-[2px]` → `after:w-0.5`; `after:content-['']` dropped (Tailwind 4 adds it for `after:`). The tooltip
    arrow's `rounded-[2px]` is dropped (DESIGN.md has radii `md` and `lg` only).
15. **The sidebar's colours are DESIGN.md's and the mockup's** (`.side`, `.nav`), not shadcn's `--sidebar-*`
    variables, which the tokens don't have: the sidebar is `bg-secondary` (`sidebar-text`); its items are
    `text-muted-foreground` at rest and `bg-card text-foreground` on hover (`accent` is the sidebar's own colour, so
    a hover in it didn't show); the current page is the card with the mockup's 2 px ink bar on its left
    (`shadow-sidebar-current`); counts are `text-faint`; group labels are the eyebrow (`text-eyebrow`, uppercase,
    faint). The `sidebar-border` classes → `border`. Its width is DESIGN.md's 228 px, not 16 rem: the `w-sidebar` utility (`styles/components.css`), not the registry's
    inline `--sidebar-width` style (see change 36).
16. **Focus** (as change 5): the toast's `ring-[3px] ring-ring/50` and the sidebar's `ring-sidebar-ring` /
    `focus-visible:ring-2` → the solid 2 px outline with a 2 px gap in the `ring` token. The dropdown's items
    (plain, checkbox, radio, submenu trigger) showed keyboard focus only as the `accent` fill, about 1.1:1 on the
    popover; they get the same outline (`focus-visible:`), and keep the fill (Iris F4 on #206).
17. **Elevation and shape (DESIGN.md):** every registry shadow → `shadow-frame`, the one soft shadow: `shadow-lg`
    on the dropdown's submenu, the sheet and the toast; `shadow-md` on the dropdown (the sidebar's floating and inset
    variants, which had `shadow-sm`, went in change 28). Radii are `md` and `lg` only: the toast's `rounded-2xl` →
    `rounded-lg` (12 px, as cards); the menu items' and the tooltip key's
    `rounded-sm` → `rounded-md`.
18. **No gold text in light mode** (as change 6): `empty.tsx`'s link hover `text-primary` → `text-foreground`,
    `dark:text-primary`. The sheet's overlay `bg-black/10` (a palette colour) → `bg-foreground/10`,
    `dark:bg-background/60`, and its `backdrop-blur-xs` is dropped: the tint alone dims the page, as nothing else in
    DESIGN.md blurs (Iris F4 on #206).
19. **Motion (DESIGN.md: 150–200 ms, nothing under reduced motion):** the toast moved for 500 ms on its own curve,
    and its content faded for 250 ms; `toast-transition` and the content now use the default duration (150 ms) and
    easing, and `ease-toast` is gone. The dropdown's `duration-100` → `duration-150`. Under reduced motion every
    animation and transition stops: `motion-reduce:animate-none` on the skeleton's pulse and the toast's spinner,
    `motion-reduce:animate-none!` and `motion-reduce:transition-none` on the dropdown's and the tooltip's
    open and close (the `!` beats their `data-open:` variants), `motion-reduce:transition-none` on the sheet and its
    overlay, the toast's content and the sidebar's actions (`toast-transition` also stops itself). The gallery's
    motion test checks each story with the preference on (Iris F3 and Argus F2 on #206).
20. **Our button's variants** (change 12): the toast's action button `variant="outline"` → `secondary`.
21. **Lint:** the fixes here were in `use-mobile.ts` and the sidebar's open state and cookie, all removed by change 28.
22. **No interface text of their own** (§21: it lives in `apps/web/messages/en.json`): the registry's English names
    are props the caller passes. `SheetContent` takes `closeLabel`, required unless `showCloseButton={false}` (was
    "Close"); `ToastClose` takes `label` and `Toaster` `closeLabel` (was "Close toast"). Their icons are
    `aria-hidden`. The sidebar's "Toggle Sidebar", "Sidebar" and "Displays the mobile sidebar." went with the parts
    that said them (change 28).
23. **Type (DESIGN.md's scale):** the empty state's and the sheet's titles → the `h2` token (`text-h2`, its weight and
    tracking; were `text-lg tracking-tight` and `font-medium`). `EmptyTitle` is a real heading, `h2` by default, so
    screen-reader users can jump to it (was a `div`); a page that needs another level passes `render={<h3 />}`
    (Iris F2 on #206); the toast title → the `h3` weight; the dropdown's
    group label → `label`; `text-xs` (12 px, not on the scale) → `text-meta` (13 px) on the tooltip, the shortcut, the
    sidebar's small sizes and counts, and `text-label` on the small avatar; the shortcut's `tracking-widest` is gone;
    `font-medium` on the active sidebar item → the label weight.
24. **Targets (WCAG 2.5.8):** the sidebar's group and menu actions were 20 × 20 px on desktop, with an invisible
    larger area only on touch widths that overlapped the menu button. They are 24 × 24 px (`size-6`) on every width,
    centred in each button size, with no extra area.
25. **Overlays render where the caller says:** `DropdownMenuContent` (and the submenu's), `TooltipContent`,
    `SheetContent` and `Toaster` take `container`, passed to Base UI's portal (the body by default). The gallery
    renders them into a box in its canvas (`src/gallery/stage.tsx`), so the screenshot, focus and motion tests see
    them.
26. **Screenshots are the same every run:** `SidebarMenuSkeleton`'s text bar had a random width (50–90%); it takes a
    `width` prop (70% by default), as the classes `max-w-11/20`, `max-w-7/10` and `max-w-4/5` (change 36).
27. **No cookie (§16: essential cookies only; Athena's decision on #205, 2026-11-11):** the registry's
    `SidebarProvider` wrote a `sidebar_state` cookie on every open and close. With change 28 there is nothing to open
    or close, so no state and no cookie; `sidebar.test.tsx` checks that rendering it writes none.
28. **The v1 mockup's frame (Zeus, #205, 2026-11-11):** on desktop a 228 px sidebar, always open; below 900 px a
    scrolling row of links at the top, which #75 builds. So the registry's sidebar loses what the mockup doesn't
    have: the icon rail (`collapsible="icon"`, `SIDEBAR_WIDTH_ICON`, the menu buttons' tooltips that named items
    there), off-canvas collapsing (`collapsible="offcanvas"`), the open state with `useSidebar`, `onOpenChange`, the
    ⌘B shortcut, `SidebarTrigger` and `SidebarRail`, the phone sheet (the `isMobile` branch, `SIDEBAR_WIDTH_MOBILE`,
    `mobileTitle` and `mobileDescription`), the `floating` and `inset` variants and `side="right"`, with the
    utilities only they used (`w-sidebar-icon-gap{,-border}`, `{left,right}-sidebar-hidden`, `transition-width`,
    `transition-inset-width`, `transition-margin-opacity`, `transition-size-padding`). `use-mobile.ts`, which only
    the phone sheet used, is deleted. `Sidebar` is the mockup's `.side`: the surface tint with a hairline on its
    right. `Sheet` and `Tooltip` stay as general components.
29. **A loading sidebar you can see (Iris F1 on #206):** the skeleton's `bg-muted` is the sidebar's own `secondary`
    (`#F1F0EC` light, `#22201C` dark), so its loading rows vanished. In `SidebarMenuSkeleton` the shapes are
    `bg-border-strong`, like the mockup's placeholders on the tint; `sidebar.test.tsx` reads both themes' tokens and
    checks the skeleton differs from the sidebar by at least 1.3:1 (`border` alone is about 1.15:1).
30. **Whole initials in an avatar group (Iris F2 on #206):** `AvatarGroup`'s `-space-x-2` overlap, with each avatar's
    2 px ring, covered the right edge of the initials before it; it is `-space-x-1`, and the type keeps its size.
31. **The mockup's nav in the gallery (Iris F3 on #206):** the sidebar stories follow `.nav`: Inbox, Calendar and
    Brands, the pinned brands under a "Pinned brands" eyebrow with each brand's mark (the mockup's sample marks, in
    `src/gallery/mark-*.svg`), then Settings. `SidebarGroupAction` and `SidebarMenuAction` stay in the component as
    options for later screens; the stories don't use them, as the mockup's nav has no "+" or "…".
32. **Nav items at the body weight (Zeus, #75, 2026-11-11; replaces the active item's label weight in change 23):**
    every sidebar nav item, `SidebarMenuButton` and `SidebarMenuSubButton`, sets `font-normal` (400), the current page
    included. The current page is marked by its card and 2 px bar alone (`data-active:bg-card`,
    `data-active:shadow-sidebar-current`); the `data-active:font-(weight:--font-weight-label)` class is gone.
    `sidebar.test.tsx` resolves the weights the item's classes can set from the compiled CSS.
33. **A shimmering skeleton (§05, #75; replaces the pulse in change 19):** `animate-pulse` and
    `motion-reduce:animate-none` → `skeleton-shimmer` (`styles/components.css`): a band over the shape, moved with
    `transform` only, which stands still and is not drawn under reduced motion. `skeleton.test.tsx` checks the keyframes
    and the reduced-motion rule from the compiled CSS.
34. **The mockup's shimmer values (Iris F5 on #219; Athena's decision 1 on #75, 2026-11-11):** `skeleton-shimmer`'s
    band is the mockup's `.shimmer::after`: a 100° gradient, transparent to 30%, white at 35% at 50%, transparent from
    70%, a 1.6 s loop; it replaces change 33's 90° band of the text colour at 8%. The white is a raw colour in
    `components.css`, the one the `globals.test.ts` guard allows (that exact stop). In dark the same white band is a light
    wash across the dark muted surface, as in the mockup.
35. **The narrow row (Iris F4 on #219; the mockup's `@media (max-width: 900px)` for `.side` and `.nav`):**
    `SidebarProvider` is now a container named `sidebar` (`@container/sidebar`) around its wrapper, and
    `styles/components.css` defines the `sidebar-narrow` variant (`@container sidebar (max-width: 900px)`) and
    `shadow-sidebar-current-narrow` (the 2 px bar under the current link). Below 900 px the wrapper stacks, `Sidebar`
    is a row that scrolls sideways with its hairline underneath, the menus are rows, links stay on one line
    (`whitespace-nowrap`), the badge is inline, group labels are hidden, and a caller hides a group with
    `sidebar-narrow:hidden` (the mockup's `.brandnav`). It is measured on the frame, not the window, so the gallery's
    `NarrowRow` story draws it in a 384 px box; in the app the frame is as wide as the window. `sidebar.test.tsx` reads the
    compiled CSS.
36. **No `style` attribute in the frame's HTML (Argus F1 on #221; #222):** the app's policy is `style-src 'self'
    'nonce-…'`, so a `style` attribute written in server HTML is blocked. `SidebarProvider` no longer writes
    `--sidebar-width` inline; `Sidebar` takes `w-sidebar` (`styles/components.css`, 228 px), and the skeleton's
    widths are the fraction classes of change 26. `sidebar.test.tsx` renders the frame and fails on any `style=`.
