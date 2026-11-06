# Section 7: Posts: types, layouts, sizes, looks (Draft, waiting for Zeus)

**Goal:** define what a post is, which layouts exist, which sizes each network gets, the four looks, and the post
content format, in enough detail to build the renderer (§08), the AI writer (§09) and the editor (§11).

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| Layouts beyond the core set? | All four extras: **testimonial, photo card, meme, before/after** |
| How many looks? | **4**: Bold, Clean, Editorial, Playful |
| How far can an agency change a look? | **Brand tokens + a few safe switches**; layouts stay fixed |
| Bilingual brands? | **Linked versions only** (one EN post and one BN post); no mixed-language slides |

## Spec

### Post kinds

| Kind | Slides | Notes |
|---|---|---|
| Single image | 1 | Any layout |
| Carousel | 2–10 | Cover → content → call to action. Capped at **10** at launch, even where a network allows more (6–10 is the sweet spot for engagement and keeps AI cost and review time down); Pinterest 5, X 4 |
| Story | 1 | 9:16, larger safe zones |
| Question | 1 | `question` layout; answers come in the comments (exports can't create native polls) |
| Text-only | 0 | Caption only, on networks that allow posts without media (see the network table) |
| LinkedIn document | 2–10 | A carousel exported as one PDF |

### Layouts

Core layouts come from the studio's renderer (cover, fact, step, question, promo → **offer**, cta, text) plus new
ones (list, quote, stat); the four extras were chosen by Zeus.

| Layout | Used for | Fields | Rules |
|---|---|---|---|
| `cover` | First slide of a carousel | kicker, title (`*word*` = highlight), body?, image?, sticker? | Title ≤ 8 words |
| `fact` | One sourced fact | kicker, title, image?, body, **source** | Source required |
| `step` | How-to sequences | step n/of, image, title, body | One step per slide |
| `list` | Tips, checklists | title, 3–5 items | Items ≤ 8 words each |
| `quote` | A line from the brand's people or a sourced public quote | quote, person, role | Public quotes need a source |
| `stat` | A big number | number, label, **source** | Source required |
| `question` | Community questions | kicker, question, 2–4 options (text or image) | Answers in comments |
| `offer` | Launches, discounts, events | badge, title, details/price, image?, call to action | Prices and dates must match the brief or kit; no false urgency |
| `cta` | Last slide of a carousel | logo or mascot, title, body, call to action | |
| `text` | Type-only designs | kicker, title, body, source? | |
| `testimonial` | Customer voice | quote, customer name, detail, photo? | **The quote is supplied by the agency, never written by the AI** (the AI may only trim it, and the editor sees the diff). An editor ticks "customer agreed to be quoted" before it can go to the client. A photo only from the brand's library, with consent |
| `photocard` | News-style card (ফটোকার্ড) | photo, headline, one fact, source, photo credit | Photo from the library (stock after launch); fact sourced |
| `meme` | 1–2 panels | panel images or mascot, labels, text | **Brand's own art, library photos or mascot only; never meme templates or third-party characters.** Off by default; the brand kit switches it on |
| `beforeafter` | Two panels side by side | before photo, after photo, labels, caption | Both photos from the brand's library, same real subject. Results claims (health, beauty, fitness) are flagged for confirmation (§22) |

### Sizes

Every post has one design, rendered in each size its networks need. Layouts adapt per size (a story moves text out of
the larger safe zones). The size list is confirmed by the network table below.

| Size | Pixels | Ratio |
|---|---|---|
| `portrait` | 1080 × 1350 | 4:5 |
| `square` | 1080 × 1080 | 1:1 |
| `story` | 1080 × 1920 | 9:16 |
| `landscape` | 1200 × 675 | 16:9 |
| `pin` | 1000 × 1500 | 2:3 |

### Networks

Checked 2026-11-06 against official help pages and developer docs (marked **O**), with third-party sources
(marked **3P**) only where the official ones are silent. Limits change often: they live in `config/networks.ts`
with a source and date each, and are re-checked before launch.

**Which size each network gets (LetZeusPost's defaults):**

| Network | Single image | Carousel (our cap) | Story | Text-only post |
|---|---|---|---|---|
| Instagram | 4:5 portrait | 4:5, up to 10 | 9:16 | no |
| Facebook | 4:5 portrait | 4:5 multi-image, up to 10 | 9:16 | yes |
| LinkedIn | 4:5 portrait | PDF document, 4:5 pages, up to 10 | — | yes |
| X | 16:9 landscape | up to 4 images, 1:1 | — | yes |
| Threads | 4:5 portrait | 4:5, up to 10 | — | yes |
| TikTok | 9:16 photo | 9:16 photos, up to 10 | — | no |
| Pinterest | 2:3 pin | 2:3, up to **5** | — | no |

**The limits behind that table:**

| Network | Images | Max per post | Caption | Tags | Alt text | File (through APIs) |
|---|---|---|---|---|---|---|
| Instagram | 1.91:1 to 4:5, 320–1440 px wide (O). 3:4 works in the app since May 2025 (3P) but not through the API, so we use 4:5. Every carousel slide is cropped to the first slide's ratio (O) | 20 (O) | 2,200 characters, 20 @-tags (O) | **5 hashtags** since Dec 2025 (3P news; the API page still says 30, so we enforce 5) | 1,000 characters, not for stories (O) | **JPEG only**, 8 MB (O) |
| Facebook | 4:5 or 1:1 recommended; stories 9:16 (3P) | not documented | 63,206 characters is widely quoted, not found officially | — | yes, `alt_text_custom` (O) | JPEG, PNG and others up to 10 MB; PNG over 1 MB may look pixelated (O) |
| LinkedIn | 3:1 to 4:5, at least 552×276, 1080 px wide recommended (O) | 20 images (O); document posts up to 300 pages, 100 MB, all pages the same size, title required (O) | 3,000 characters (widely quoted, not confirmed) | — | up to 4,086 characters, under 120 recommended (O) | JPG, PNG, GIF; PDF for documents (O) |
| X | 16:9 or 1:1 are safe; extreme ratios and multi-image grids get cropped (3P) | 4 images (O) | 280 weighted characters: emoji and CJK count 2, any URL 23; **Bangla counts 1 per character** (O) | — | supported (1,000 characters, not verified) | JPG, PNG, GIF, WebP; 5 MB (O) |
| Threads | 320–1440 px wide, up to 10:1 (O) | 2–20 in a carousel (O) | 500 characters; through the API each emoji counts as its byte length (O); more than 5 links fails since Dec 2025 (O) | 1 topic tag (3P) | 1,000 characters (O) | JPEG, PNG; 8 MB (O) |
| TikTok | 1080×1920 recommended (3P) | 35 photos (O) | title 90 + description 4,000, counted in UTF-16 units (O) | — | **no field** (O) | **JPEG or WebP only**, 20 MB, max 1080p (O) |
| Pinterest | 2:3 (1000×1500); taller pins get cut off (O) | carousel 2–5 images, 1:1 or 2:3 (O) | title 100 (about 40 shown), description 800 (O) | no limit documented | 500 characters; **not on carousels** (O) | PNG, JPEG; 20 MB (O) |

**Safe zones:** Instagram and Facebook stories: keep about 250 px at the top and 250–340 px at the bottom free of
text (3P). TikTok: keep text inside the centered ~960×1386 px area, clear of the bottom and right edges (3P). Our
story layouts use the stricter of these.

**What this decides for LetZeusPost:**
1. **Images export as JPEG** (sRGB, high quality, under 5 MB), because Instagram and TikTok take only JPEG or WebP through
   their APIs, and so would a scheduler posting for us. PNG stays available on request; LinkedIn carousels export as PDF (§12).
2. **Instagram captions carry at most 5 hashtags.**
3. **Caption lengths are counted the way each network counts:** X weighted characters, TikTok UTF-16 units,
   Threads bytes for emoji, the others plain characters.
4. **Carousels are capped** at 10 slides (our choice), 5 for Pinterest and 4 images on X.
5. Alt text is written for every slide, and exported only where the network supports it.

Sources: [Instagram Graph API media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) ·
[Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing) ·
[Instagram 3:4 (Lindsey Gamble, May 2025)](https://lindseygamble.com/blog/instagram-now-supports-34-aspect-ratio-for-photos-and-carousel-posts) ·
[Instagram 5-hashtag limit (BetaNews, Dec 2025)](https://betanews.com/2025/12/19/instagram-puts-a-limit-on-hashtag-usage) ·
[Facebook Page photos](https://developers.facebook.com/docs/graph-api/reference/page/photos) ·
[Facebook Page stories](https://developers.facebook.com/docs/page-stories-api) ·
[LinkedIn images help](https://www.linkedin.com/help/linkedin/answer/100983) ·
[LinkedIn documents help](https://www.linkedin.com/help/linkedin/answer/97459) ·
[LinkedIn Documents API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api) ·
[LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api) ·
[X media best practices](https://docs.x.com/x-api/media/quickstart/best-practices) ·
[X counting characters](https://docs.x.com/fundamentals/counting-characters) ·
[Threads overview](https://developers.facebook.com/docs/threads/overview) ·
[Threads publishing](https://developers.facebook.com/docs/threads/reference/publishing) ·
[TikTok photo post API](https://developers.tiktok.com/doc/content-posting-api-reference-photo-post) ·
[TikTok media transfer](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide) ·
[Pinterest product specs](https://help.pinterest.com/business/article/pinterest-product-specs) ·
[Pinterest alt text](https://help.pinterest.com/en/business/article/add-alternative-text-to-your-pins)

### The four looks

Each look is a set of tokens in the `DESIGN.md` format (§21), filled with the brand's own: primary, accent,
background, ink, heading and body fonts per language, logo for light and dark backgrounds, and an optional mascot.

| Look | Character | Type | Shapes and highlight | Good for |
|---|---|---|---|---|
| **Bold** | Loud, high contrast, motion | Big condensed headlines | Diagonal stripes; highlight = color block | Gyms, events, retail sales |
| **Clean** | Calm, lots of space | Rounded sans | Soft tinted ground; highlight = underline | Clinics, professional services, software |
| **Editorial** | Quiet, magazine-like | Serif display + sans body | Thin rules; highlight = rule underline | Restaurants, real estate, consultants |
| **Playful** | Warm, friendly | Heavy rounded display | Tilted "print" photo frames, stickers; highlight = pill | Cafés, kids, community brands (the studio's own picasso look) |

**Switches an agency can set per brand:** corner style (sharp / soft / round) · image frame (none / print / rounded /
full-bleed) · highlight style (the look's default, pill, underline or color) · decorations on or off · logo position
(bottom-left, bottom-right, top). **Not adjustable:** layout geometry, type scale, safe zones.

**Contrast:** every text/background pair must reach 4.5:1 (3:1 for headlines of 48 px or more at 1080 width), checked
at render. If the brand's colors fail, the look uses a darker or lighter shade of that color and warns the editor.

### Text and fit rules

- **Shorten, don't shrink** (product principle 2): a headline may auto-fit down to 85% of its size; past that, the AI
  shortens the words (at most 2 tries), then the post is marked "Needs a fix". Body text never goes below **32 px at
  1080 width** (24 px at 1000 width for pins).
- **Bangla:** `lang="bn"`; body line-height at least 1.65, headings at least 1.3; no letter-spacing, uppercase or italic
  transforms; Bangla digits (০–৯) in Bangla text; on-slide text length is measured in graphemes (caption limits use
  each network's own counting rule, above). The exact numbers are tested in §08's golden renders.
- **Safe zones:** text stays out of each network's overlay areas (from the network table); feed sizes keep a 64 px margin.
- Every slide gets alt text; `*word*` marks the highlight.

### Captions

One caption per network: its own length and hashtag limits, a hook in the first line, links only where that network
makes them clickable (otherwise "link in bio" wording), and title fields where a network has them. Hashtags come from
the brand kit's list plus at most a few topical ones.

### Post content format (post.json v2)

```json
{
  "brand": "golpo", "lang": "bn", "linkedTo": "post_123_en",
  "kind": "carousel", "networks": ["instagram", "facebook"], "date": "2026-12-14T12:30:00+06:00",
  "look": { "name": "playful", "switches": { "corners": "round", "frame": "print", "highlight": "pill" } },
  "slides": [
    { "layout": "cover", "kicker": "শীতের গল্প", "title": "ফিরে এল *পিঠা* সপ্তাহ",
      "image": { "asset": "ast_9f2", "crop": [0, 120, 1080, 900], "focus": "center" }, "alt": "…" }
  ],
  "captions": { "instagram": { "text": "…", "hashtags": ["#গল্পক্যাফে"] }, "facebook": { "text": "…" } },
  "sources": [], "credits": [],
  "flags": { "aiImage": false, "claimsConfirmed": null, "testimonialConsent": null }
}
```

Layout fields follow the layout table; the full schema (zod) is written with §08 and §09.

## Not in the MVP

Both languages on one slide · video, GIF or animated posts · custom layouts · more than 4 looks · carousels over 10
slides · native polls · stock and AI images (right after launch; Section 1 scope check).

## Done when

- Every layout renders in every size, in EN and BN, within the fit rules, with sample content (golden renders, §17).
- Each look passes the contrast check with all three sample brands.
- The network table lives in `config/networks.ts` with the source and date of every limit, and captions are checked against it.

## Depends on

[01](01-product-spec.md), [04](04-flows-and-screens.md), [05](05-app-design.md). Feeds §06, §08, §09, §11 and §12.
