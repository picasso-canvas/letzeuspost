# Section 8: Render engine (Approved 2026-11-06)

> **Stack:** decided in [§13](13-architecture.md) (approved 2026-11-06). Where this doc differs, §13 wins.

**Goal:** turn a post (§07's post.json) into pixel-exact slides in every size its networks need: one HTML builder
shared by the editor preview and the final render, Chrome in Docker, fonts (Bangla included), the fit check that drives
the AI's shortening, and the output files (JPEG, PNG, PDF, thumbnails).

## Decided earlier

| Topic | Decision | Where |
|---|---|---|
| Layouts, sizes, looks | 14 layouts, 5 sizes, 4 looks + switches; post.json v2 | §07 |
| Fit | **Shorten, don't shrink**: headlines may auto-fit to 85%; body never below 32 px at 1080 width (24 px at 1000 for pins); then `fitFix` (at most 2 tries), then "Needs a fix" | §07, §09 |
| Bangla | `lang="bn"`; body line-height ≥ 1.65, headings ≥ 1.3; no letter-spacing, uppercase or italic; Bangla digits; length in graphemes | §07 |
| Contrast | 4.5:1 for text (3:1 for headlines ≥ 48 px), checked at render; a failing brand color is shaded and the editor warned | §07 |
| Editing | Instant preview in the browser; final images re-rendered about 2 s after editing stops, cached by content | §11 |
| Outputs | JPEG (sRGB, < 5 MB) by default, PNG on request, LinkedIn carousels as PDF with selectable text | §07, §12 |
| Images | Crop and focus point per size; at most 1.25× enlargement | §10 |
| Goldens | The looks and layouts are approved designs; changing their golden renders needs Zeus | §21 |

## Spec

### Starting point: the studio renderer

The studio's `social-posts` renderer (`render.mjs` + `base.css`, about 380 lines, used for the studio's first post batch in week 46) is the base.

| Keep as it is | Change for LetZeusPost |
|---|---|
| Wait for fonts and image decoding before measuring; no fixed timers (the page reports when it's done) | String templates with `esc()` → **React components rendered to static HTML** (automatic escaping; props typed from the post schema) |
| Measure block boxes, not glyph ink (tall Bangla glyphs spill a few px past their lines) | 9 layouts → the **14** of §07 (`promo` becomes `offer`; new `list`, `quote`, `stat`, `testimonial`, `beforeafter`) |
| One `--k` text scale lowered until everything fits | `--k` stops at **0.85** (the studio goes to 0.60) with the body floor, then the AI shortens |
| `*word*` highlights, a unique URL per page load, frames sized to the crop | 3 sizes → **5**, each with its own arrangement (below) |
| Logo on light or dark, page numbers and "Swipe" in the post's language and digits | One theme per brand → **4 looks × brand tokens × switches** |
| | `file://` paths → assets served by the worker only (no network, below) |
| | Raw DevTools protocol + the Mac's Chrome → **Playwright with a pinned Chromium in Docker** |
| | PNG only → PNG master, then JPEG, PDF and thumbnails |
| | Report by CSS class → a **fit report by field** (`slides[2].title`) with a target length for the AI |

**Measured on Zeus's M1 (2026-11-06), the studio renderer on last week's posts:** Chrome starts in 0.6 s; once it's
running, a slide takes **0.4 s (4:5) to 0.5 s (9:16)** including the PNG; PNGs are 0.7–1.6 MB. Two of the four
published posts fit only at **82%**, below LetZeusPost's 85% limit, so they would have gone to `fitFix`: expect
shortening on a fair share of posts (§09's cost estimate already counts one fit fix per post).

### One HTML builder for preview and render

- `buildSlide(post, slide, size, kit)` returns one HTML page: the layout, the look's CSS, the brand's tokens as CSS
  variables, the fonts and the fit script. It has no server-only code, so the **same function runs in the editor and
  in the worker**.
- **Editor preview:** the HTML goes into a sandboxed iframe (`srcdoc`, scripts allowed, no same-origin), scaled to fit
  the screen, updated about 150 ms after each keystroke. Its fit script reports live hints ("Title: about 12
  characters too long for 16:9").
- **The server render is the truth.** Safari or Firefox can break lines slightly differently from Chrome, so the
  status (`Needs a fix`), the client's review page, the grid cards and every export use the worker's renders. The
  editor shows "Final render ✓" when the worker's render matches the current text, and the worker's fit warnings
  replace the preview's.

### Sizes and arrangements

| Size | Pixels | Text area inside the margins | Arrangement |
|---|---|---|---|
| `portrait` 4:5 | 1080 × 1350 | 952 × 1222 (64 px margins) | stacked |
| `square` 1:1 | 1080 × 1080 | 952 × 952 | stacked, smaller type; meme panels side by side |
| `story` 9:16 | 1080 × 1920 | 878 × 1286 (top 250, right 130, bottom 384, left 72: the stricter of Instagram's and TikTok's overlays, §07) | stacked, larger type |
| `landscape` 16:9 | 1200 × 675 | 1088 × 563 (56 px margins) | **two columns**: text left, image right |
| `pin` 2:3 | 1000 × 1500 | 880 × 1380 (60 px margins) | stacked, logo at the top |

- The 64 px feed margin also covers Instagram's profile grid, which shows posts cropped to 3:4 (about 34 px off each side, 3P).
- Body floor per size: 32 px at 1080 wide, 36 px for landscape (1200 wide), 24 px for pins (§07).
- **X fallback (Zeus, 2026-11-06):** if a single-image post doesn't fit at 16:9 after one shortening try, its X
  version uses 1:1 instead (X takes 1:1, §07), so the text for every other network isn't cut just for X.

### Looks in the renderer

- Each look is a CSS file on top of the shared base, plus its `DESIGN.md` tokens (§21). The brand kit fills the
  tokens: colors, fonts per language, logos for light and dark, mascot. The switches become classes on the page
  (`corners-round frame-print hl-pill decor-off logo-top`).
- Looks use only **print-safe CSS**: no CSS filters, backdrop blur or blend modes, and textures as small image tiles,
  so the PDF looks the same as the JPEG.
- **Text never sits on a photo without a scrim of at least 60%.** That guarantees about 5.7:1 for white text on the
  brightest possible photo, so contrast is computed from the tokens and never guessed from pixels. (The studio's
  photo-card credit uses a 50% scrim, about 4.0:1 at worst; the port raises it.)
- The contrast check runs on the tokens before rendering: each text/background pair the layout uses, at its real size.

### Fonts

- **Self-hosted, never fetched at render time.** Fonts live in our storage and the worker image, with a manifest:
  family, weights, languages, licence, file hash, and per-font line-heights for Bangla (starting at §07's minimums,
  tuned with the golden renders).
- **A curated library of free fonts (OFL)**, a default English + Bangla pair per look. Starting candidates, picked
  with the golden renders and Zeus's eye: Bold: Anton + Anek Bangla (condensed). Clean: Nunito + Hind Siliguri.
  Editorial: Fraunces + Source Sans 3, Tiro Bangla + Noto Sans Bengali. Playful: Bagel Fat One + Baloo 2, Baloo Da 2
  (the studio's picasso pair).
- **Licensed uploads** (§06 asks for "upload your licensed file" when a site uses a commercial font): TTF, OTF or
  WOFF2; the agency ticks that its licence covers images and PDFs. The upload check reads the file, confirms it covers
  the language it's set for (Bangla letters for a Bangla font), and reads its embedding permission. Uploaded fonts are
  private to the workspace, reach the browser only through short-lived links for its signed-in members (never the
  client review page, which shows rendered images), and a font that forbids embedding makes that brand's LinkedIn PDF
  use image pages, with a note in the export dialog.
- **No silent fallbacks.** Every font used on the slide is loaded explicitly before measuring; a font that fails to
  load fails the render. After rendering, Chrome reports which font actually drew each text block, and any fallback
  (a Latin font drawing Bangla, a missing glyph) is a fit-report error.

### Bangla

- Headlines use balanced line breaks and body text avoids a lone word on the last line (`text-wrap: balance` /
  `pretty`); no hyphenation.
- **Checked before rendering** (the text validator, shared with §09's output checks):
  - A vowel sign or hasanta with no letter before it is rejected: it would print as a dotted circle (◌).
  - The zero-width joiner and non-joiner are **kept** (the র‍্য in র‍্যাংকিং needs one); other invisible characters are removed.
  - `*highlight*` markers must sit on word boundaries; a highlight inside a word would break the letter shaping.
  - Latin digits in Bangla text are a warning (§07: Bangla digits).
- Grapheme counts follow Unicode 15.1, where a conjunct like ক্ষ counts as one; the worker image pins the Node and
  ICU versions so counts never change between machines.
- No emoji on slides at launch (captions can have them): one less font to manage and test.

### The fit check

The fit script runs inside the page after fonts and images are ready:

1. Size image frames to their crop and focus point (§10).
2. Find the largest `--k` between **1.00 and 0.85** at which every text block stays inside the content area and no
   line overflows. Body text is held at its floor; small print (sources, credits, page numbers) is a fixed 28 px at 1080 and
   never scales. Image boxes keep at least 26% of the height, so text can't squeeze a photo away.
3. Report, per slide and size:

| Check | Result |
|---|---|
| Doesn't fit at 85% | **fail**, with the fields to shorten and a target length each |
| Fits only below 100% | note (the scale used) |
| Text outside the safe zone | fail |
| A font fell back, or an image didn't load | fail |
| A contrast pair under its minimum | fail, or warn if the look's auto-shade fixed it |
| Image enlarged more than 1.25× | warn (§10) |
| A headline over 4 lines | warn |

**Fit report example** (stored with the render, given to `fitFix` and shown in the editor):

```json
{ "size": "landscape", "slide": 1, "k": 0.85, "status": "fail",
  "fields": [{ "field": "slides[0].title", "lines": 4, "graphemes": 52, "overflowPx": 88, "targetGraphemes": 38 }] }
```

`targetGraphemes` is the current length × (room available ÷ room needed at 85%) × 0.95, so the AI gets a number,
not "make it shorter".

### The shortening loop (with §09)

1. Render every size the post needs, **the size with the least text room first**, so a failure shows up early.
2. If a size fails: `fitFix` shortens the named fields to their targets, for the strictest failing size, keeping the
   meaning and language (§09). Then all sizes render again.
3. At most 2 tries; then the X fallback above, if it applies; then **Needs a fix**, with the report in the editor.

### Outputs

| Output | How |
|---|---|
| **PNG master** | Chrome's lossless screenshot at 1×, colors forced to sRGB. Every other image is made from it |
| **JPEG** (default) | Quality 90, **no chroma subsampling** (keeps colored text crisp), progressive, sRGB profile embedded, no other metadata; if over 5 MB, quality steps to 85 then 80 |
| **PNG** (on request) | The master, with its sRGB tag |
| **LinkedIn PDF** | All slides in one HTML document, one page each (`@page` at the slide's size, no margins), printed by Chrome with backgrounds, a tagged PDF where stable, fonts embedded. It reuses each slide's `--k` from the image render, so the pages match the JPEGs exactly. Photos use 1600 px copies, keeping 10 pages well under LinkedIn's 100 MB. The PDF title is the post's hook (§12) |
| **Thumbnails** | 360 px WebP for the app's cards; the client review page shows the full JPEG, the same file that is exported |

### Chrome in Docker

- **Playwright driving a pinned Chromium**, in the **same Docker image** the visual tests use (§21), so CI's golden
  renders and production renders come from the same browser and fonts. Fixed flags in one place: 1× scale, sRGB
  color, no font hinting, hidden scrollbars.
- One browser per worker process; **a fresh browser context per job**, so nothing (cache, storage) carries from one
  workspace to another; up to 4 pages in parallel (tuned in §14).
- **Limits:** 20 s per slide, 2 minutes per post. A crash retries once in a new browser, then the post is `Failed`
  with a plain reason (§11). The browser restarts every 500 renders and whenever memory passes its limit.

### Security

- **The render browser has no internet.** Every request from the page is intercepted: the job's own assets, fonts and
  CSS are served from storage; anything else is blocked and logged. It's a different browser (and container) from the
  one that reads client websites (§06 `safe-fetch`), which needs the internet but never sees other workspaces' data.
- All post text enters as escaped text; highlights become elements through the parser, never raw HTML. A strict
  content policy allows only our fit script (by hash).
- Logos and images load as `<img>`, where an SVG's scripts never run; uploads are sanitized when they arrive (§10).

### When renders happen, and caching

1. After `writePost` and `pickImages` (§09): every size and output the post's networks need.
2. While editing: the preview instantly; the worker about 2 s after typing stops, the slide and size on screen first.
3. **Before a post can be sent for approval, all its outputs are current** (the LinkedIn PDF included).
4. **Approval freezes the files.** Exports use them as they are: what the client approved is what's exported. A small
   fix after approval (§11) re-renders and the editor shows before and after.

**Cache key:** a hash of the renderer version, look version, the brand's tokens and fonts, the slide content, the
image assets with their crops, the size and the format. The same key reuses the stored file. PNG masters of drafts are
replaced as they change; approved posts keep theirs.

**Speed target on the production server:** at most 1.5 s per slide per size (95% of renders), so a 12-post batch
(about 120 slide renders) finishes in 2–3 minutes on one worker. Memory per page is measured in the first build
milestone, and §14 sizes the server from it.

### Golden renders (with §17)

- Every layout × size × look × language with sample content from the three sample brands: 14 × 5 × 4 × 2 = **560
  images** in full (**200 at launch**: 10 layouts × 2 looks, §18), plus hard cases: the longest allowed text in each field, Bangla full of conjuncts, ya-phala and reph, a
  missing image, a font with no Bangla, a brand palette that fails contrast.
- Run in the Docker image whenever the render code, looks or fonts change: about 5 minutes on one worker, under 2 with
  4 in parallel. Two runs on the same input must give identical pixels.
- Changing a golden needs Zeus (§21); the PR shows before, after and the difference.

## Decisions confirmed by Zeus (2026-11-06)

1. **X falls back to 1:1** when a single image doesn't fit at 16:9 (a small change to §07's X default).
2. **No emoji on slides** at launch; captions can have them.
3. **Uploaded fonts:** licence tick, private to the workspace, image-page PDF when the font forbids embedding.
4. **Approval freezes the rendered files**; exports never re-render an approved post.
5. **Small print fixed at 28 px** at 1080 width (sources, credits, page numbers), and a **36 px body floor for 16:9**
   (1200 wide); §07 set only the 1080 and pin floors.

## Found while planning (for §10, §13, §14, §20)

- **Image library licences:** the usual Node image library (sharp) is Apache-2.0, but its built-in libvips is
  LGPL-3.0. The licence allowlist (§20) needs an explicit exception for it. **Zeus allowed it on 2026-11-06** (§13, A14).
- **HEIC (§10):** sharp's ready-made builds are expected not to decode iPhone HEIC photos (HEVC patents); a custom
  build or a separate decoder is needed. **Confirmed**; HEIC is converted by Cloudflare Images instead, because of the HEVC patents (§16, §13 A14).
- **Copying Bangla text out of a PDF** often comes out garbled, because conjuncts don't map one-to-one to letters.
  The PDF still looks sharp; whether copying works is tested before launch (§12's "selectable text").

## Not in the MVP

Video, GIF or animated posts · different text per size · custom layouts or custom CSS · emoji on slides · WebP or
AVIF exports · print (CMYK) files · scripts other than Latin and Bangla.

## Done when

- All golden renders pass in the Docker image (200 at launch, 560 in full), and two runs give identical pixels.
- The editor preview (in Chrome) and the worker break lines the same way on the sample set.
- A too-long slide is caught, named by field with a target length, and `fitFix` + re-render fixes at least 80% of the
  test set's too-long slides within 2 tries.
- The Bangla test set shows no dotted circles and no fallback fonts, and its grapheme counts match a hand count.
- A render can't reach the network: content containing a remote image link is escaped, and any request outside the
  job's assets is blocked and logged.
- JPEGs are sRGB, without chroma subsampling, under 5 MB; a PDF has one page per slide, all the same size, fonts
  embedded, and uploads to LinkedIn as a document (checked by hand).
- A deliberately bad palette fails the contrast check and is auto-shaded; text over photos always has its scrim.
- On the production server size, 95% of slides render within 1.5 s, and 1,000 renders in a row don't grow memory
  (the browser recycles).

## Depends on

[06](06-brand-kits.md) (kit tokens, fonts, logos), [07](07-posts.md), [09](09-ai-pipeline.md) (`fitFix`, `qc`),
[10](10-images.md) (crops, focus), [11](11-review-and-approvals.md) (preview, approval), [12](12-export-and-calendar.md)
(outputs), [13](13-architecture.md) and §14 (worker, storage, server size), §17 (goldens), [21](21-ai-design-workflow.md),
[22](22-product-ai-guardrails.md) (isolation).
