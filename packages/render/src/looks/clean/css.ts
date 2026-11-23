// The Clean look's CSS, on top of the shared base (§07 The four looks, §08 Looks in the renderer). Calm, lots of space:
// the slide sits on a soft tint of the brand's primary, the kicker and the highlight are in the primary, and the
// highlight is an underline. Type is the kit's (Clean's own pair is Nunito + Hind Siliguri, rounded sans).
//
// Rules it keeps:
// - Print-safe only: no filter, backdrop blur or blend mode, and no image (`color-mix` and plain borders only).
// - No sizes, margins, gaps or line-heights: the base owns geometry, type scale and safe zones (§07, not adjustable),
//   and Bangla keeps the manifest's line-heights and balanced headings.
// - Every colour that text sits on is one the contrast check knows (`contrast.ts`): the ground, the shape, the pill.
// - Every switch class has a rule (§07: corners, frame, highlight, decorations, logo).

export const CLEAN_CSS = `
.look-clean {
  --clean-ground: color-mix(in srgb, var(--primary) var(--clean-ground-tint), var(--background));
  --clean-shape: color-mix(in srgb, var(--primary) var(--clean-shape-tint), var(--background));
  --clean-pill: color-mix(in srgb, var(--primary) var(--clean-pill-tint), var(--background));
  background: var(--clean-ground);
}
.look-clean .slide {
  position: relative;
  z-index: 0;
}
.look-clean .kicker { color: var(--primary); }
.look-clean .title, .look-clean .body, .look-clean .small-print, .look-clean .page-number { color: var(--ink); }

.corners-sharp { --clean-radius: var(--clean-radius-sharp); --clean-shape-radius: var(--clean-shape-radius-sharp); }
.corners-soft { --clean-radius: var(--clean-radius-soft); --clean-shape-radius: var(--clean-shape-radius-soft); }
.corners-round { --clean-radius: var(--clean-radius-round); --clean-shape-radius: var(--clean-shape-radius-round); }

.hl-default mark.hl, .hl-underline mark.hl {
  color: var(--primary);
  text-decoration-line: underline;
  text-decoration-color: var(--primary);
  text-decoration-thickness: var(--clean-underline);
  text-underline-offset: var(--clean-underline-offset);
}
.hl-pill mark.hl {
  color: var(--ink);
  background: var(--clean-pill);
  border-radius: var(--clean-radius);
  padding: 0 0.2em;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.hl-color mark.hl { color: var(--primary); }

.frame-none .image-box {
  border-radius: 0;
  border: none;
}
.frame-rounded .image-box {
  border-radius: var(--clean-radius);
  overflow: hidden;
}
.frame-print .image-box {
  border: var(--clean-print-border) solid var(--background);
  border-radius: var(--clean-radius);
  box-shadow: 0 0 0 var(--clean-print-ring) var(--clean-shape);
  overflow: hidden;
}
.frame-full-bleed .image-box {
  border-radius: 0;
  border: none;
}
.stack.frame-full-bleed .image-box {
  margin-left: calc(-1 * var(--ml));
  margin-right: calc(-1 * var(--mr));
}
.cols.frame-full-bleed .image-box {
  align-self: stretch;
  margin: calc(-1 * var(--mt)) calc(-1 * var(--mr)) calc(-1 * var(--mb)) 0;
}

.decor-on .slide::before {
  content: '';
  position: absolute;
  z-index: -1;
  width: 44%;
  aspect-ratio: 1;
  border-radius: var(--clean-shape-radius);
  background: var(--clean-shape);
}
.decor-off .slide::before { content: none; }

.logo-bottom-left .slide::before { top: -10%; right: -12%; }
.logo-bottom-right .slide::before { top: -10%; left: -12%; }
.logo-top .slide::before { bottom: -10%; right: -12%; }
`;
