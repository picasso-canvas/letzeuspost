# Section 4: User flows and screens (Approved 2026-11-06)

**Goal:** every screen, what's on it, and how people move between them, so the Section 5 mockups and the code have no gaps.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| What does an agency member see first? | An **action inbox** across all brands |
| How is a batch shown? | **Calendar + grid toggle** |
| First time a new agency signs in? | A **guided first batch** |
| Interface language? | **English only** (posts are EN or BN) |
| Assignment? | Each **batch has one owner** (its creator by default, can be changed); the Inbox filters "my batches" |
| Agency staff on phones? | **Review and approve only** (Inbox, view posts, approve, comment, send to the client); editing stays on desktop and tablet |

The app is desktop-first (best at 1280 px+, works on tablets). The **client review page is mobile-first**, because
clients open links on their phones.

## Spec

### Sitemap

```
Public      /sign-in   /invite/[token]   /r/[token] (client review)
First run   /welcome  (guided first batch, 4 steps)
App         /                         Inbox (home)
            /calendar                 all brands, month/week
            /brands                   brands grid
            /brands/new               brand from website
            /b/[brand]                brand home: its calendar + "Create" actions
            /b/[brand]/kit            Identity · Voice · Look · Rules · Publishing · Holidays
            /b/[brand]/assets         asset library
            /b/[brand]/batches/new    ?job=calendar | brief | link
            /b/[brand]/batch/[id]     ideas stage, then posts stage (calendar ⇄ grid)
            /b/[brand]/post/[id]      post editor
            /settings                 Workspace · Members · Plan & usage · Notifications · Review page · Account
Owner       /admin                    Zeus only (Section 15)
```

**Global frame:** left sidebar (Inbox, Calendar, Brands with pinned brands, Settings; usage meter at the bottom),
top bar (workspace name, search ⌘K for brands and posts, **+ Create** → New calendar / One-off post / From a link,
notifications bell, avatar).

### Screens

| Screen | What's on it | Main actions |
|---|---|---|
| **Inbox** | Grouped across all brands: *Needs your review* · *Client feedback* (approved, comments, changes requested) · *Needs a fix* (failed checks, generation errors) · *Due soon* (posts in the next 7 days not yet approved or exported) · *Generating now* (progress). Each row: brand logo, first-slide thumbnail, hook, date, networks. Filter by brand and "my batches". | Open, approve, send to client, retry |
| **Calendar** | Month/week; posts as chips colored by brand; holidays shown on their dates | Open post, filter brands |
| **Brands** | Tile per brand: logo, look, posts this month, items waiting | Open, new brand |
| **New brand** | 1 URL (or "set up by hand") → 2 reading the site (screenshot, logo, colors, fonts, voice appear as found) → 3 check the kit next to 3 sample slides, pick a look → 4 languages, country/timezone, networks, approval mode | Save brand |
| **Brand home** | That brand's calendar (all batches), upcoming holidays, recent batches with status | New calendar / One-off / From a link |
| **Brand kit** | Tabs: Identity (name, logos light/dark, colors, fonts per language) · Voice (tone, audience, pillars, do/don't words, CTAs, hashtags, example posts) · Look (preset + live sample) · Rules (claims to avoid, required legal lines, banned topics) · Publishing (networks, sizes, timezone, usual posting times, approval mode, client reviewer emails) · Holidays (country, days on/off, custom dates like the brand's anniversary) | Edit, preview |
| **Asset library** | Grid with filters (logo, photo, product, people, generated), AI description and tags, licence/credit, "used in N posts" | Upload, edit tags/licence, delete |
| **New batch** | J1: period, posts per week, networks, languages, themes/notes · J2: brief, date, networks, type (auto), language, photos · J3: URL → summary + 3–5 suggested posts to tick | Plan ideas / Generate |
| **Batch: ideas stage** | Calendar with idea cards (type, pillar, hook, networks, language, time) and holiday chips ("+ make a post"); list panel beside it | Edit, drag to another date, drop, add, "re-plan with a note"; **Generate N posts** (shows the quota it uses) |
| **Batch: posts stage** | Stepper (Ideas → Generating → Review → Client → Approved → Exported). Calendar ⇄ grid toggle. Card: thumbnail, status, QC badge (pass/warn/fail), EN/BN, network icons, comment count. Live progress per post: Writing → Images → Rendering → Checking → Ready. | Multi-select: approve, send to client, regenerate, export, delete |
| **Post editor** | Left: slides (reorder, add, duplicate, delete) + EN ⇄ BN switch. Center: live preview, size tabs (only the sizes its networks need), safe-area overlay, zoom. Right tabs: **Slide** (layout, fields, image picker: library / stock / generate / none) · **Captions** (one per network, character counter vs limit, hashtags, alt text) · **Checks** (QC results, "fix with AI") · **Sources & credits** · **History** (versions, restore) · **Comments**. Top: breadcrumb, date/time, networks, status, **AI rewrite** box ("shorter", "more playful"; applies to the slide or the whole post), Regenerate with a note. | Approve · Send to client · Request changes; ← → next/previous post |
| **Export dialog** | Scope (post / selection / batch / approved only); formats: ZIP (PNGs per size + captions + alt text), LinkedIn PDF, CSV for Buffer / Hootsuite / Metricool (times in the brand's timezone); export history | Download; posts marked Exported |
| **Client review** (`/r/[token]`) | Agency logo + "Posts for ‹Brand›, ‹period›", note from the agency, progress "8 of 12 approved". Post cards: swipe slides, date, captions per network (collapsed). First visit asks name + email. | Approve · Request changes (comment required) · Comment on a slide · Approve all remaining |
| **Settings** | Workspace (name, logo and name shown on review pages, default timezone) · Members (invite, roles) · Plan & usage (posts, AI images, brands, seats; invoices) · Notifications · Account | |

On a phone, agency staff get: Inbox, the batch grid, a read-only post view, approve, comment and send to the client.

### Journeys

**First run (guided first batch, about 5 minutes):** sign in from the invite → workspace name and "your role" →
paste the first client's website (or "try a demo brand") → reading the site → confirm logo, colors, voice; pick a
look → choose networks and language → **generate a sample week (5 posts, free, not counted)** → land in the batch
review while it generates → a checklist afterwards: invite your team, set the approval mode, try a client link.

**J1 Content calendar:** + Create → New calendar → brand, period, posts/week, networks, languages, notes → ideas
stage (edit, move, drop, add, holidays) → Generate → posts stage (progress) → review in the editor → approve or send
to the client → client approves on their phone → Export.

**J2 One-off:** + Create → One-off → brief → Generate → opens straight in the post editor when ready. One-offs
collect in an automatic batch per brand per month ("One-off posts · Nov 2026"), so every post lives in a batch.

**J3 From a link:** + Create → From a link → URL → summary + 3–5 suggestions → tick → Generate → a batch named after the page.

**J4 Holidays:** they show on the brand calendar and in the ideas stage, and J1 suggests them as ideas. The brand
kit's Holidays tab switches days on or off.

**Client approval:** the editor sends selected posts → the client gets an email from LetZeusPost in the agency's name →
the review page → approve / comment / request changes → the agency sees it in the Inbox. Changes requested → editor
edits → resend (the client sees only what changed) → approved.

### States and messages

- **Empty:** every screen has one clear next action (e.g. Inbox: "Nothing waiting. Make a calendar for ‹brand›").
- **Loading:** skeletons; generation shows per-post steps; the user can leave and come back.
- **Errors:** the site can't be read → set up by hand · a post fails → reason + Retry · text can't fit after 2 tries →
  "Needs a fix" with the slide marked · quota reached → message + "contact us" (Zeus raises design partners' limits) ·
  review link expired or revoked → "Ask ‹agency› for a new link".
- **Notifications** (bell + email, set per person): batch ready · client approved / commented / requested changes ·
  @mention · posts due in 48 h not approved. Clients get the review email and one reminder after 2 days (the agency
  can turn it off).

Onboarding (the checklist after the first run, team members joining, onboarding emails, the design-partner
playbook) is specified in [Section 23](23-onboarding.md).

## Not in the MVP

Network mockups (a post shown inside an Instagram frame), comments pinned to a spot on a slide, drag-and-drop
rescheduling across brands on the all-brands calendar, the post editor on phones, assigning single posts, saved filters.

## Done when

- Each journey (first run, J1–J4, client approval, export) can be clicked through screen by screen in the Section 5
  mockups with no dead ends.
- Every screen has its empty, loading and error states.

## Depends on

[Section 1](01-product-spec.md).
