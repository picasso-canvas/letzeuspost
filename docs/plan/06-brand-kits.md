# Section 6: Brand kits (Draft, waiting for Zeus)

> **Stack details pending §13.** Mentions of the Chrome worker, `safe-fetch` and storage are assumptions collected in
> [13-architecture.md](13-architecture.md).

**Goal:** what a brand kit holds, every way to create one (**including brands with no website**), the brand editor,
the asset library, and how the kit feeds writing, design and checks.

## Questions for Zeus

| Question | Answer |
|---|---|
| Brands without a website? | **Must work from day one** (Zeus, 2026-11-06). Many brands, especially in Bangladesh, have only a Facebook Page or nothing online |
| Read Facebook / Instagram pages automatically? | **Proposed: no.** Store the link for captions; ask for screenshots of recent posts instead (social pages sit behind log-ins, and the networks' terms forbid scraping) |
| Brands without a logo? | **Proposed:** a temporary wordmark (the name in the brand's heading font and color), clearly marked and replaceable. Real logo design is a separate studio service |
| Who fills in the 8 questions? | **Proposed:** the agency, at launch (on a call with the client, or from what they know). A link the client fills in comes after launch |

## Spec

### What a kit holds

| Part | Contents |
|---|---|
| **Identity** | Name (EN + BN), short name, logo for light and dark backgrounds, mark, colors (primary, accent, background, ink, extras), heading and body fonts per language, optional mascot |
| **Voice** | 3 tone words, audience, 3–6 content pillars, words to use and never use, calls to action, hashtags (at most 5 per Instagram post, §07), example posts, main language per network, notes for the writer |
| **Facts** | What the brand sells, prices (with the date they were checked), opening hours, locations, public contacts, founding date, what makes them different. **The only source the writer may use for claims about the client** (principle 3) |
| **Look** | One of the 4 looks + switches (§07) |
| **Rules** | Claims to avoid, required lines ("terms apply"), restricted-industry flag (§22), topics to skip, memes on or off, competitors not to name |
| **Publishing** | Networks and handles, sizes, timezone, usual posting times, approval mode, client reviewers |
| **Holidays** | Country, days on or off, custom dates |

Every item records **where it came from** (website page, uploaded file, typed by the agency, "the client said") and
when. The kit is versioned, and each post stores the kit version it used.

### Every way to start a kit

The New brand screen asks **"What do you have for this brand?"** Any mix works, and more can be added later.

| Start from | How | What it fills |
|---|---|---|
| **A website** | `safe-fetch` reads up to 10 pages on the same domain (home, about, menu or products, contact) in a sandboxed browser, then extracts | logo, colors, fonts, voice, facts with source URLs |
| **Files (no website)** | The agency uploads the logo, **3–10 recent posts** (screenshots of Facebook posts are fine), photos, and documents (menu, price list, brochure, brand guide). Claude's vision reads them | colors (sampled from the logo and posts), closest free fonts, tone and repeated phrases (including Bangla text in the images), facts from documents |
| **A social link** | Facebook Page or Instagram handle, saved as a reference. **Not read automatically** | caption links and handles |
| **Answers** | 8 questions, about 3 minutes: what they sell · who their customers are · city and country · languages · 3 tone words · words they never use · what posts should achieve · colors they like (or "pick for me") | voice, facts, a starting palette |

Then Claude drafts the kit and 3 sample slides. Each item shows its source and how sure it is (**found** · **guessed** ·
**needs you**). The agency fixes what's wrong and saves. **Before the first batch**, five essentials must be filled:
name, at least one color, tone, language, country.

**Missing pieces:**
- **No logo:** a temporary wordmark (the name in the heading font and primary color), labelled "temporary" in the editor.
- **No photos:** type-only layouts carry the posts until photos are uploaded (images at launch are library + type-only, §01).
- **No fonts known:** the look's default pair, matched to the brand's tone.

### Reading a website, step by step

1. `safe-fetch` (§20): public URLs only (private IP ranges and redirects to them blocked), robots.txt respected, at
   most 10 pages, 2 MB each, 20 seconds in all.
2. A sandboxed headless browser renders each page and takes a screenshot.
3. **Logo candidates**, ranked: the SVG or image in the header, `og:image`, the touch icon, the favicon.
4. **Colors:** CSS variables, the computed colors of buttons and headers, and a palette from the screenshot,
   reduced to 3–5 swatches.
5. **Fonts:** the computed font families, matched to free Google Fonts. A commercial font is flagged ("upload your
   licensed file").
6. **Text → kit:** an extraction step with no tools and a strict schema reads the page text as untrusted data (§22)
   and returns the voice profile and the facts, each fact with its source URL.

### Reading uploaded files

- Accepted: PNG, JPG, WebP, SVG, PDF; up to 20 MB each, 30 files per brand at a time.
- Images are converted to sRGB, at most 4096 px, with **location and camera data (EXIF) removed**. PDFs are read as text.
- Vision: dominant colors, the logo, a description of the type style matched to free fonts, and the text in post
  screenshots (Bangla included; accuracy tested with real samples) to learn tone and recurring hashtags.
- Photos with recognisable people need a consent tick before they can be used (§22).

### The brand editor

Tabs: **Identity · Voice · Facts · Look · Rules · Publishing · Holidays** (Facts is new to §04's list). Each field shows
its source. A live sample slide updates as you edit. "Read the website again" or "Add more files" can be run any
time; new findings arrive as suggestions to accept. **They never overwrite what the agency typed.** A completeness
meter on the brand tile ("Kit 85%") says what would help most, e.g. "Add 3 example posts to sharpen the voice".

### Asset library

- Kinds: logo, photo, product, people, document (AI-generated after launch).
- Upload by drag and drop, several at once. Each asset gets an AI description and tags (the `tagAsset` task, §09), a
  licence or credit field (own photo / supplied by the client; stock and AI after launch), a consent tick for
  recognisable people, a focus point and crop, and a "used in N posts" count. Duplicates are detected.
- Deleting an asset that posts use asks first; already exported posts keep their images.
- Storage limits per plan (§02).

### How the kit is used

- **Writer (§09):** voice, facts, rules and pillars, sent as the cached part of every prompt.
- **Renderer (§08):** identity and look.
- **QC (§22):** checks posts against the rules, the never-say words and the facts. A claim about the client that isn't
  in the facts, or in a source, is flagged.

## Not in the MVP

Reading Facebook or Instagram pages automatically · a brand questionnaire the client fills in by link · logo design
(a studio service) · exporting the kit as a brand-guide PDF · sub-brands · different voices per network.

## Done when

- A brand can be created each of four ways (website, files only, answers only, a mix) and reaches a usable kit in
  under 5 minutes.
- Website reading on 10 real sites (5 of them Bangladeshi) gets the logo and colors right on at least 8, and never
  follows an instruction planted in a page.
- File reading on 5 Facebook-only businesses (logo + post screenshots) gives a voice and colors Zeus judges usable.
- Every kit field shows its source; reading again never overwrites an agency edit.
- EXIF data is removed from every upload, and consent ticks are enforced.

## Depends on

[01](01-product-spec.md), [04](04-flows-and-screens.md), [07](07-posts.md), [20](20-builder-guardrails.md) and
[22](22-product-ai-guardrails.md) (safe fetching, untrusted input), [23](23-onboarding.md) (first run).
