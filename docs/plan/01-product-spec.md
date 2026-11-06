# Section 1: Product spec (Approved 2026-11-06)

**Goal:** fix what LetZeusPost is, who uses it, what the MVP does and doesn't do, and how we know it works.

**In one line:** LetZeusPost makes a month of on-brand social posts for each of an agency's clients. AI plans,
writes, designs and checks them; people edit and approve; and the agency exports them ready to schedule.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| Which jobs must the MVP do? | All four: content calendar, one-off post from a brief, turn a link into posts, holidays and events |
| Which networks? | Instagram, Facebook, LinkedIn, X, Threads, TikTok, Pinterest |
| What can the agency's client do? | Approve and comment through a share link; no account |
| What proves the MVP works? | All four: they pay, time saved, few edits, weekly use |
| How many versions for a one-off post? | 1 post; edit it or regenerate it with a note |
| Bilingual brands? | Linked EN + BN versions of a post, each written natively |
| Holiday calendars? | Public holidays for any country from a free data source + a curated observance list for Bangladesh, India, the US, the UK and global days |

## Spec

### Who uses it

| Role | Who | Can do |
|---|---|---|
| Owner | agency founder | everything, plus billing and deleting the workspace |
| Admin | ops / account lead | brands, members, settings; no billing |
| Editor | content person | make batches and posts, edit, approve for the agency, export |
| Viewer | account manager, intern | look and comment only |
| Client reviewer | the brand's owner | through a share link (no account): see the posts sent to them, approve or comment on each, and send photos (§10) |
| Zeus | platform owner | owner admin panel (Section 15) |

The full permission matrix is in Section 15.

### Words we use

**Workspace** = one agency. **Brand** = one client of the agency. **Brand kit** = the brand's identity, voice, look,
assets and rules. **Batch** = a set of posts for one brand, made together. **Idea** = a planned post before it's
written. **Post** = one piece of content in one language: slides, captions per network, alt text, sources. **Slide** =
one image in a post. **Size** = the pixel format a slide is rendered in. **Look** = the design preset a brand uses.
**Review link** = the share link a client approves on.

### The four jobs

**J1 Content calendar** (the core job). An editor picks a brand, a period (week or month), posts per week, networks,
and optional themes or notes. LetZeusPost proposes ideas on a calendar, mixing post types and including holidays (J4).
The editor keeps, edits, drops or adds ideas, then generates them all. Posts come back written, designed and checked,
ready for review.

**J2 One-off post from a brief.** The editor writes a short brief ("launch announcement for the new menu, Friday,
Instagram + Facebook"), optionally attaches photos, and optionally picks the post type. LetZeusPost makes **one** post.
The editor edits it or regenerates it with a note; it counts as 1 post.

**J3 Turn a link into posts.** The editor pastes a URL (blog post, product page, YouTube video). LetZeusPost reads it
and proposes 3–5 posts (e.g. a summary carousel, quote cards, a key-number card, a promo). The editor picks which to
generate. The link is recorded as the source. MVP limit: for YouTube it reads the title, description and chapters
(transcripts come in v2).

**J4 Holidays and events.** Public holidays for any country (from a free data source), plus a curated list of
observances for Bangladesh, India, the US, the UK and global days, plus industry days (e.g. World Food Day for a
restaurant). They show on the calendar, J1 offers them as ideas, and the agency can switch days on or off per brand.

Every job ends the same way: **review and edit → approval (by the brand's mode) → export.**

### Languages

Posts are English or Bangla. A brand that uses both gets **linked EN + BN versions** of a post: same idea and design,
each written natively (never translated), reviewed and exported together. Each language version counts as a
separate post against the quota ([Section 2](02-pricing-and-billing.md)).

### Networks

Every network is supported for sizes and caption rules; the exact limits are verified in Section 7.

| Network | Formats | Caption |
|---|---|---|
| Instagram | feed 4:5 and square, carousel, story 9:16 | long caption, a few hashtags |
| Facebook | 4:5 / square, multi-image | long caption |
| LinkedIn | square / portrait image, **PDF document carousel**, landscape link image | professional tone, longer |
| X | landscape 16:9 or square, up to 4 images | short, character limit |
| Threads | square / portrait, carousel | short, character limit |
| TikTok | photo carousel 9:16 | description + hashtags |
| Pinterest | pin 2:3 | title + description |

A post has one design that is rendered in every size its networks need, plus its own caption for each network.

### Product principles (carried over from the editz studio)

1. On-brand above everything: colors, fonts, voice and rules come from the brand kit.
2. When text doesn't fit, shorten the words; never shrink the layout.
3. Every fact has a source; claims about the client come from the client's own kit and site.
4. Original only: no meme templates, no copyrighted art; stock and fonts carry their licence and credit.
5. AI-generated images are labelled synthetic.
6. Bangla is written natively, not translated from English.
7. Nothing reaches the client before the QC check passes.

### Success with the design partners (measured over 6–8 weeks)

| Measure | Target | How it's measured |
|---|---|---|
| They pay | at least 1 of the 1–3 agencies moves to a paid plan | billing |
| Time saved | a month of posts for one brand in under 1 hour | app events: batch created → exported |
| Few edits | 70%+ of posts approved with no or small edits (small = no regeneration and at most 2 field edits) | post version history |
| Weekly use | every partner exports at least 1 batch a week for a real client | app events |

The app records these events from day one, and Zeus's admin panel (Section 15) shows them.

### MVP scope check (Zeus, 2026-11-06, after the self-review)

| Area | At launch | After launch |
|---|---|---|
| Networks | **All 7** (Instagram, Facebook, LinkedIn, X, Threads, TikTok, Pinterest): confirmed | — |
| Jobs | **All 4**: J1 calendar, J2 one-off, J3 link → posts, J4 holidays: confirmed. J4 starts with hand-curated lists for the partners' countries (the option as described); worldwide holiday data follows | worldwide holiday data |
| Images | **Brand library + type-only layouts** (photos the client sends and product cutouts move to right after launch, [§18](18-launch.md)) | client photos and cutouts (M8), then stock search (Pexels/Unsplash), then AI image generation |
| Layouts and looks | **10 core layouts, the Playful and Clean looks** ([§18](18-launch.md)) | testimonial, photo card, meme, before/after; Bold and Editorial (M8) |
| Export | ZIP + **Metricool** CSV (the partners' scheduler) + LinkedIn PDF | Buffer and Hootsuite CSVs |
| Public website | **One page**: what LetZeusPost is, pricing, terms, privacy, refunds (Paddle's review needs it; §02, added 2026-11-06) | the full marketing site |

## Not in the MVP

Video (Reels, Shorts); direct scheduling and publishing; stock search and AI image generation (right after launch); Buffer and Hootsuite CSVs; analytics; a free canvas editor; client accounts and
post requests; a white-label custom domain; a mobile app; languages beyond EN/BN; public self-serve
sign-up and a full marketing site (one public page is in, §02); YouTube transcripts; A/B variants for testing.

## Done when

- Zeus approves this section (done 2026-11-06).
- Every later section traces back to J1–J4, the networks table and the success measures.

## Depends on

The first interview (2026-11-06).
