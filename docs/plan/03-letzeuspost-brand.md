# Section 3: LetZeusPost brand (Approved 2026-11-06)

**Goal:** LetZeusPost's own identity: name, logo, colors, type, voice and tagline, the domain and handles, the
trademark steps, and the one-page public site that the payment provider reviews (§02).

Mockups (version 12): https://claude.ai/artifact/L47yVDF9nHEdrnYKaPHiDe (screens "Logos" and "Public page"). Files:
`docs/design/logos/letzeuspost/` (the draft) and `docs/design/logos/letzeuspost/variants/` (A, B, C).

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| The draft logo? | **Refine it**: three variants were made, and Zeus picked **A · Crisp strike** |
| Tagline? | **"A month of posts, before lunch."** |
| A Bangla version of the name? | **No: English name only**; Bangla appears in taglines and posts |
| Domains? | **letzeuspost.com only** |
| The name check found medium risk; what now? | **Keep the name, get a lawyer's clearance search, then file** |

## Spec

### Name

- **LetZeusPost**, one word with three capitals. Never "Let Zeus Post", "Letzeuspost" or "LZP" in anything public
  (LZP is fine in code and notes).
- **The idea:** an agency lets Zeus, a helper with a bolt of energy, make its clients' posts. The myth is a light
  touch: a bolt and a few lines of wit, never a Greek-gods theme.

### Logo (A · Crisp strike)

| Part | Spec |
|---|---|
| **Mark** | A gold rounded tile (60 × 60 on a 64 grid, corner radius 16) struck by an ink bolt (`M39.5 6.5 L18.5 36 H31 L25 57.5 L46.5 27 H34.5 Z`) |
| **Wordmark** | Let**Zeus**Post in Inter: Let and Post SemiBold (600), Zeus ExtraBold (800), letter-spacing −0.03 em |
| **Lockups** | Mark + wordmark, horizontal, for light (ink text) and dark (paper text) backgrounds; the mark alone for app icons, favicons and avatars |
| **Clear space** | A quarter of the tile's width on every side |
| **Smallest size** | Mark 16 px; full logo 96 px wide |
| **Don't** | Gold text on white (1.9:1, §05) · recolor the bolt · rotate, stretch, add shadows or gradients · put the mark on a busy photo without a solid backing · split the name |

**Final files** (made 2026-11-06, in `docs/design/logos/letzeuspost/`; outlining waits for Zeus's OK on a font tool): the mark and both lockups as SVG with the wordmark **converted
to outlines** (no font needed to display them; needs a font tool, installed only with Zeus's OK), plus PNGs, a favicon
set (16, 32, 48 px and SVG), an Apple touch icon (180 px), app icons (192 and 512 px), a social share image (1200 ×
630), an email header logo (PNG, since many email apps don't show SVG), the Paddle checkout logo, and square avatars
for the social accounts. B, C and the first draft stay in `variants/` for the record.

### Colors

| Token | Hex | Use |
|---|---|---|
| Gold | `#F5B301` | The tile, primary buttons, highlights. **Fill only** in light mode, with ink on it (about 9.4:1) |
| Ink | `#1C1A17` | The bolt, text on light backgrounds |
| Paper | `#F3F1EC` | Text on dark backgrounds, warm light surfaces |
| Deep amber | `#8A5D00` | Gold-family text and links on light backgrounds (5.8:1 on white, 5.1:1 on paper) |

The app's full palette (neutrals, status colors) is §05's.

### Type

**Inter** for the logo, the app and the public page (§05). Bangla on the public page and in emails uses **Hind
Siliguri**. Clients' posts use their own brands' fonts (§08).

### Voice

| We are | We aren't |
|---|---|
| Plain and direct: short sentences, real numbers ("a month of posts for one brand in under an hour") | Hype: "revolutionary", "AI magic", "10× your content" |
| Calm and capable, like a good producer | Cute everywhere: wit lives only in loading and empty states (§05) |
| Respectful of agencies' craft: LetZeusPost does the heavy lifting, people decide | "Replace your team" |
| Honest about AI: it drafts, people approve, and facts have sources | Vague about what the AI does |

Examples: "Zeus is writing your captions…" (loading) · "Nothing waiting. Even gods take breaks." (empty) · "This
photo is too small for 9:16. Pick another or crop differently." (error: plain, no joke) · welcome email signed by Zeus
(§23).

### Tagline

**"A month of posts, before lunch."** It's backed by §01's success measure (a month of posts for one brand in under
an hour). A supporting line, where there's room: "On-brand social posts for every client, in English and বাংলা."

### Domain, email and handles

- **letzeuspost.com:** Zeus buys it himself (it was free on 2026-11-06), with DNS at Cloudflare (the files are on R2,
  §13). Proposed layout, settled in §14: `letzeuspost.com` the public page · `app.letzeuspost.com` the app and client
  review links · a sending subdomain for email with SPF, DKIM and DMARC.
- **Addresses:** `zeus@` (the welcome email and partners, §23) · `hello@` (the public page) · a no-reply sender for
  notifications, with Reply-To set as §11 says.
- **Handles:** claim **@letzeuspost** now on Instagram, Facebook, LinkedIn (company page), X, Threads, TikTok and
  YouTube, before the name is public. X, Facebook, Threads and YouTube looked free on 2026-11-06; the others couldn't
  be checked automatically.

### The name check and trademark (first pass 2026-11-06, not legal advice)

**Medium risk.** Nothing uses "LetZeusPost", and the domain and most handles are free. But "Zeus" is crowded in
software: several live US trademarks for ZEUS in class 42, including one covering marketing SaaS (ZEUS' BOUNTY), a
pending ZEUS application for online and influencer marketing (also an EU mark), and a new "Zeus" AI content engine for
marketing agencies (The ContentForge, waitlist opened 2026-10-31; no trademark found). The crowding also means each
owner's rights are narrow, so the combined name LetZeusPost has a fair chance.

**Steps (Zeus):**
1. **Now:** buy letzeuspost.com and claim the handles.
2. **Before the public page goes up** (and before Paddle's review): a trademark lawyer runs a **clearance search** in
   the US, EU, UK and Bangladesh, with the clashes above as input. If it comes back bad, rename now, while it's cheap.
3. **If clear:** file in **Bangladesh** (DPDT), class 42 and probably 35: about **৳30,000 per class** in official fees
   (search, application, publication, certificate) plus the lawyer.
4. **When selling in the US:** a USPTO filing, from **$350 per class**, through a US-licensed attorney (required for
   foreign applicants). Bangladesh isn't in the Madrid system yet, so other countries are filed one by one.
5. Keep an eye on the ContentForge "Zeus" product.

### The one-page public site (`letzeuspost.com`)

Needed for Paddle's review (§02). Shown on the mockups' "Public page" screen.
- **Top:** the logo; Sign in; **Ask for an invite** (an email to Zeus, since sign-up is invite-only).
- **Hero:** the tagline, one paragraph on what it does (EN and বাংলা posts, approval, export to Metricool), and three
  sample posts from the fictional brands.
- **How it works:** three steps (a kit for each client · a month, written and designed · approve and export).
- **Pricing:** the three plans with a **US dollars / Taka** switch, the annual and refund lines, and who handles
  payment (Paddle abroad; the Bangladeshi company for taka).
- **Footer:** the company's legal name and address, Terms, Privacy, Refunds (§16), `hello@letzeuspost.com`.
- One static page, light and dark, fast, no tracking cookies; sample posts are the fictional brands' (studio rule:
  original only, no real clients without their written OK).

### A studio brand kit

On approval, Athena also writes **`brands/letzeuspost/` in the editz studio** (the studio's `brand-kit` skill), so the
studio's departments can make LetZeusPost's own launch posts and videos in this identity.

## Not in the MVP

A full marketing site, blog or docs site · a Bangla name or wordmark · other domains (.ai, .com.bd) · a mascot ·
merchandise · filing outside Bangladesh before selling there.

## Done when

- The logo files (outlined SVG, PNGs, favicon and icon sets, share image, email logo, avatars) are in
  `docs/design/logos/letzeuspost/`, and the app and mockups use them.
- letzeuspost.com is bought and the handles claimed (Zeus).
- The clearance search is back and the decision recorded here; the Bangladesh filing is made if it's clear.
- The public page is built (a build task, after §16's terms) and approved by Zeus.
- The studio brand kit exists in `brands/letzeuspost/` (done 2026-11-06 in the editz repo, with a posts theme; a test carousel rendered).

## Depends on

[01](01-product-spec.md), [02](02-pricing-and-billing.md) (the public page), [05](05-app-design.md) (colors, type,
voice). Feeds §14 (domain, email setup), §16 (terms, privacy, refunds; the legal name), §18 (launch).
