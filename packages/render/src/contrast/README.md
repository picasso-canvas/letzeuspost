# Contrast: declaring a layout's text pairs

§07 and §08: every text/background pair reaches **4.5:1**, or **3:1** for a headline of 48 px or more at 1080 width.
The check runs on the **tokens** (the brand kit's colours), before rendering, and never looks at pixels. When a
brand's colours fail, the look uses a darker or lighter shade of that colour (`applyContrast`) and the editor is
warned.

## What a layout task does

Next to the layout, call `registerPairs` once, when the module loads. The function gets the kit, the look and the size,
and returns every pair of text the layout draws at that size, with its **real font size in pixels** at the page's own
width:

```ts
import { registerPairs } from '../contrast/pairs.ts';

registerPairs('quote', ({ size }) => [
  { name: 'quote', text: 'ink', on: 'background', px: size === 'landscape' ? 56 : 64, headline: true },
  { name: 'author', text: 'accent', on: 'background', px: 32 },
  { name: 'credit on photo', text: { hex: '#ffffff' }, on: { photo: true }, px: 28 },
]);
```

- `text` and `on` are a kit colour (`'primary'`, `'accent'`, `'background'`, `'ink'`, `{ extra: 0 }`) or a fixed colour
  the look brings itself (`{ hex: '#ffffff' }`). `on` can also be `{ photo: true }`.
- `headline: true` marks the slide's headline. It gets 3:1 only when its size is 48 px or more once scaled to 1080
  width (`px × 1080 ÷ page width`); every other text, whatever its size, gets 4.5:1.
- A layout registers once; a second `registerPairs` for the same layout throws. `pairsFor` throws for a layout that
  declared nothing, so a new layout can't skip the check.
- Pairs are declared per layout, not per look: the look's own colours reach the check through the kit (or `{ hex }`).

## Text on a photo

Text never sits on a photo without a scrim of at least 60% (`SCRIM_ALPHA`, §08). Declare the pair with
`on: { photo: true }` and paint the scrim with `scrimFor(textColour)`: its `colour` (black under light text, white under
dark text) at its `alpha`. The check judges the text behind that scrim over the brightest and the darkest possible
photo, so white text on a black 60% scrim is 5.7:1 at worst. A photo pair with no scrim can't be declared.

## What the check and the shading do

- `checkPairs(kit, look, pairs)`: for each pair, the ratio, the limit and whether it passes.
- `applyContrast(kit, look, pairs?)`: with no `pairs`, every registered layout at every size. It shades the pair's
  **text** colour when that is a kit colour, otherwise its **background** colour; a fixed colour and a photo are never
  shaded. It returns the shaded kit (the same object when nothing failed), a warning per shaded colour (`colour`,
  `from`, `to`, the pairs) and `failures`, the pairs no shade could fix (to fail the render, §08).
- `shadeToPass(colour, against, limit)`: the nearest darker or lighter shade of the same hue and saturation that passes.
