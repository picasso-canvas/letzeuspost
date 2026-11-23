// The Playful look's CSS, on top of the shared base (§07 The four looks, §08 Looks in the renderer). Warm and friendly:
// the slide sits on the brand's own background, the kicker is in the primary, the highlight is a pill of the accent
// with ink letters, photo prints are turned a few degrees, and two stickers (a round badge and a turned tag) sit in the
// corner of the safe zones away from the logo. Type is the kit's (Playful's own pair is Bagel Fat One headings on
// Baloo 2, and Baloo Da 2 for Bangla: heavy rounded display).
//
// Rules it keeps:
// - Print-safe only: no image, and no CSS effect a PDF draws differently (`color-mix`, borders and plain shadows only).
// - No sizes, margins, gaps, line-heights or weights for text: the base owns geometry, type scale and safe zones
//   (§07, not adjustable), and Bangla keeps the manifest's line-heights and balanced headings. No letter-spacing, case
//   or italic, in either language.
// - The stickers stay inside the safe zones of every size: they are placed from the margins (`--mt`, `--mr`, `--mb`,
//   `--ml`, which are the safe zones) and sized as shares of the page's shorter side.
// - Every colour that text sits on is one the contrast check knows (`contrast.ts`): the background (the ground and
//   the tag), the badge and the pill.
// - Every switch class has a rule (§07: corners, frame, highlight, decorations, logo).

export const PLAYFUL_CSS = `
.look-playful {
  --playful-short: min(var(--w), var(--h));
  --playful-badge: color-mix(in srgb, var(--accent) var(--playful-badge-tint), var(--background));
}
.look-playful .slide {
  position: relative;
  z-index: 0;
}
.look-playful .kicker { color: var(--primary); }

.corners-sharp { --playful-radius: var(--playful-radius-sharp); --playful-pill-radius: var(--playful-pill-radius-sharp); }
.corners-soft { --playful-radius: var(--playful-radius-soft); --playful-pill-radius: var(--playful-pill-radius-soft); }
.corners-round { --playful-radius: var(--playful-radius-round); --playful-pill-radius: var(--playful-pill-radius-round); }

.hl-default mark.hl, .hl-pill mark.hl {
  color: var(--ink);
  background: var(--accent);
  border-radius: var(--playful-pill-radius);
  padding: 0 var(--playful-pill-pad);
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.hl-underline mark.hl {
  color: var(--primary);
  background: none;
  text-decoration-line: underline;
  text-decoration-color: var(--primary);
  text-decoration-thickness: var(--playful-underline);
  text-underline-offset: var(--playful-underline-offset);
}
.hl-color mark.hl {
  color: var(--primary);
  background: none;
}

.frame-none .image-box {
  border: none;
  border-radius: 0;
  transform: none;
}
.frame-rounded .image-box {
  border-radius: var(--playful-radius);
  overflow: hidden;
  transform: none;
}
.frame-print .image-box {
  border: var(--playful-print-border) solid var(--background);
  border-bottom-width: var(--playful-print-foot);
  border-radius: calc(var(--playful-radius) / 4);
  box-shadow: 0 0 0 var(--playful-outline) var(--ink);
  overflow: hidden;
  transform: rotate(var(--playful-print-tilt));
}
.frame-full-bleed .image-box {
  border: none;
  border-radius: 0;
  transform: none;
}
.stack.frame-full-bleed .image-box {
  margin-left: calc(-1 * var(--ml));
  margin-right: calc(-1 * var(--mr));
}
.cols.frame-full-bleed .image-box {
  align-self: stretch;
  margin: calc(-1 * var(--mt)) calc(-1 * var(--mr)) calc(-1 * var(--mb)) 0;
}

.decor-on .slide::before, .decor-on .slide::after {
  content: '';
  position: absolute;
  z-index: -1;
}
.decor-on .slide::before {
  width: calc(var(--playful-short) * var(--playful-badge-size));
  height: calc(var(--playful-short) * var(--playful-badge-size));
  border-radius: 50%;
  background: var(--playful-badge);
  border: var(--playful-outline) solid var(--ink);
}
.decor-on .slide::after {
  width: calc(var(--playful-short) * var(--playful-tag-width));
  height: calc(var(--playful-short) * var(--playful-tag-height));
  border-radius: var(--playful-radius);
  background: var(--background);
  border: var(--playful-outline) solid var(--primary);
  transform: rotate(var(--playful-tag-tilt));
}
.decor-off .slide::before, .decor-off .slide::after { content: none; }

.logo-bottom-left .slide::before { top: var(--mt); right: var(--mr); }
.logo-bottom-left .slide::after {
  top: calc(var(--mt) + var(--playful-short) * var(--playful-tag-y));
  right: calc(var(--mr) + var(--playful-short) * var(--playful-tag-x));
}
.logo-bottom-right .slide::before { top: var(--mt); left: var(--ml); }
.logo-bottom-right .slide::after {
  top: calc(var(--mt) + var(--playful-short) * var(--playful-tag-y));
  left: calc(var(--ml) + var(--playful-short) * var(--playful-tag-x));
}
.logo-top .slide::before { bottom: var(--mb); left: var(--ml); }
.logo-top .slide::after {
  bottom: calc(var(--mb) + var(--playful-short) * var(--playful-tag-y));
  left: calc(var(--ml) + var(--playful-short) * var(--playful-tag-x));
}
`;
