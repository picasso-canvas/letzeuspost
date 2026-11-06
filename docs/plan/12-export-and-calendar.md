# Section 12: Export and calendar (Approved 2026-11-06)

> **Stack:** decided in [§13](13-architecture.md) (approved 2026-11-06). Where this doc differs, §13 wins.

**Goal:** get approved posts out of LetZeusPost ready to schedule (image files, LinkedIn PDFs, a Metricool CSV),
show every post on a calendar, and outline direct scheduling for v2.

## Decided earlier

| Topic | Decision | Where |
|---|---|---|
| Publishing | Export first; direct scheduling in v2 | §01 |
| First scheduler | **Metricool** (the partners' tool); Buffer and Hootsuite later | §01 scope check |
| Image format | **JPEG** (sRGB, under 5 MB) by default, PNG on request; LinkedIn carousels as **PDF** | §07 |
| Approvals in exports | An "approved by / when / how" record | §11 |

## Spec

### What can be exported

- From a post, a selection, a batch, or "every approved post in this batch" (the default).
- **Only approved posts are exported.** A single unapproved post can be downloaded as a preview for internal use; its
  file names start with `DRAFT_`.
- Small exports (up to 20 posts) are made right away. Bigger ones are built in the background, and a notification
  says when they're ready (§11). Download links work for 7 days; exported files are kept for 30.

### ZIP of images

```
golpo-cafe_december_2026-12-14/
  README.txt                       the posts, their dates and times (brand timezone), networks
  approvals.csv                    post, approved by, when, how (client / agency / on the client's behalf)
  2026-12-14_1230_pitha-week_en/
    4x5/01.jpg … 04.jpg            one folder per size the post's networks need
    9x16/01.jpg … 04.jpg
    captions/instagram.txt         the caption and hashtags for that network
    captions/facebook.txt
    alt-text.txt                   one line per slide
    sources.txt  credits.txt
    post.json                      the post content (§07), for other tools
  2026-12-14_1230_pitha-week_bn/   the linked Bangla version, same structure
```

File and folder names are ASCII: a slug of the English hook, or the post id, never Bangla, since some tools break on
it. Text files are UTF-8, so Bangla captions are intact.

### LinkedIn carousel PDF

One PDF per LinkedIn document post. Pages are the slides at the post's size, all the same size (LinkedIn requires it),
printed from the same HTML as the images, so the **text stays sharp and selectable**, with fonts embedded. Under
100 MB and 300 pages (§07). The PDF's title is the post's hook, because LinkedIn asks for a title when posting a
document. It's included in the ZIP and also downloadable on its own.

### Metricool CSV

Built for Metricool's **Import CSV** (Planning calendar → ⋯ → Import CSV), checked against Metricool's help center on
2026-11-06. The template itself sits behind a login, so **at build time Zeus downloads it from his Metricool account
and its exact header row is saved in the repo**; LetZeusPost fills that template and never invents columns.

**One row per post per network.** The CSV has one Text column per row, so a post going to Instagram and Facebook
becomes two rows, each with that network's own caption and only that network set to `TRUE`. A linked Bangla post adds its own rows.

| Column(s) | What LetZeusPost writes |
|---|---|
| Text | the caption for that network, hashtags included (Instagram: at most 5, §07) |
| Date, Time | the post's date and time in the brand's timezone, as `YYYY-MM-DD` and `HH:MM:SS` (the README says to pick that format in Metricool's import dropdown) |
| Draft | `TRUE` by default, so posts arrive as drafts the agency checks in Metricool; the export dialog can switch it off |
| Facebook … Threads | `TRUE` for that row's network, `FALSE` for the others |
| Picture Url 1–10 | a direct public link to each slide's JPEG, one per column (our 10-slide cap matches) |
| Alt text picture 1–10 | each slide's alt text, where the network supports it (§07) |
| Instagram Post Type, Facebook Post Type | `POST` (single image or carousel) or `STORY` |
| LinkedIn Images as Carousel | `TRUE` for LinkedIn carousels (the PDF is for posting by hand) |
| Pinterest Board, Pin Title, Pin Link | the board from the brand kit's Publishing tab (required when Pinterest is chosen), the title (≤ 100), the brand's website or page |
| TikTok Title | the title (≤ 90, UTF-16 counted, §07); privacy fields left at Metricool's defaults |
| First Comment Text | **left empty.** It's free text, so writing "false" would publish the word "false" |
| Brand name | empty: one CSV per brand, imported while that brand is open in Metricool |

**The file:** UTF-8 (Bangla intact), comma-separated, every field quoted so captions with commas and line breaks
survive. **At most 50 rows per file** (Metricool's advice), so bigger exports are split into numbered files.

**Images:** Metricool needs direct public links and may fetch the images only when it publishes. So each image gets
an unguessable public link on our storage, **kept online until 7 days after the last post date in that export**, then
removed. The links point only to finished images, never to drafts or the library.

**Checks before the CSV is made:** captions within each network's limit (§07), at most 4 images for X and 5 for
Pinterest, a Pinterest board set, every image link working. Problems are listed in the export dialog and block the CSV
(the ZIP can still be made).

**The README in the ZIP tells the agency:** the date format to pick when importing; to check that the brand's timezone
in Metricool matches LetZeusPost's; that Metricool's own auto-publish setting at import time decides whether drafts
publish; and that Metricool's free plan publishes only 20 posts a month.

**Not yet confirmed by Metricool's docs, so tested before launch:** that imported times use the Metricool brand's
timezone; that several Picture Urls with `POST` make an Instagram carousel; that Bangla survives the import; where the
Picture Url and Alt text columns sit in the real template.

Sources: [Metricool: schedule posts in batch with a CSV](https://help.metricool.com/en/article/how-to-schedule-posts-in-batch-with-a-csv-file-in-metricool-3wihqx/) ·
[Metricool: CSV troubleshooting](https://help.metricool.com/common-troubleshooting-when-importing-csv-into-metricool-m2lcv) ·
[Metricool: Instagram](https://help.metricool.com/schedule-and-post-on-instagram-6b6q5) ·
[Metricool: TikTok](https://help.metricool.com/schedule-and-post-on-tiktok-bkepi) ·
[Metricool: planning settings](https://help.metricool.com/how-planning-settings-work-jsu0i) ·
[Metricool: free vs premium](https://help.metricool.com/en/article/main-differences-between-free-and-premium-plans-1udj06m/)

### After exporting

- Posts become **Exported**, with the export recorded. Re-exporting is allowed.
- **Export history** per batch: who, when, which formats and posts, with re-download while the files are kept.
- Editing an exported post: a small fix (§11) shows "Already exported on ‹date›: re-export it and replace it in
  Metricool"; a bigger change sends it back for approval as usual.

### Calendars

- **All-brands calendar** (§04): month and week views; posts as chips in the brand's color with a status icon;
  holidays; filters for brand, status and network; clicking a chip opens the post.
- **Brand calendar:** the same for one brand. **Dragging a post to another day or time reschedules it.** Moving an
  approved post changes its date, so by §11's rule it needs re-approval; the calendar asks first ("This post is
  approved. Moving it sends it back to Rafiq for approval. Move it?").
- Times are in the **brand's timezone**; when the viewer's own timezone differs, hovering shows both.
- Posting times come from the brand kit's usual times (§06). Best times from data come with analytics, after launch.

### Direct scheduling (v2 outline)

Three ways, to choose after the design-partner phase:
1. **Metricool's API**, posting into the agency's own Metricool account. It needs Metricool's Advanced or Custom
   plan; posts go to `POST /api/v2/scheduler/posts` with ISO dates and a timezone, media first goes through its
   "normalize" step, and media links must stay public and never expire ([Metricool API guide](https://help.metricool.com/basic-guide-for-api-integration-r97af)).
2. **Each network's own API** (Meta for Instagram and Facebook, LinkedIn, X, TikTok, Pinterest): no middleman,
   but each needs an app review.
3. **A unified posting API** (a paid service with a fee per connected profile).

Whichever is chosen will need: a connection per brand and network, tokens stored encrypted, a publishing queue with
retries, status brought back into LetZeusPost ("Published" with the live post's link), and the same gates as export
(approved only).

## Not in the MVP

Direct publishing · Buffer and Hootsuite CSVs · a calendar feed for Google or Apple Calendar · analytics and
best-time suggestions · Google Business Profile posts.

## Done when

- A 12-post EN + BN batch exports as a ZIP, the LinkedIn PDFs and a Metricool CSV, with Bangla intact everywhere.
- The CSV imports into a **test brand** in Metricool (as drafts) with every field landing in the right place,
  carousels included.
- A LinkedIn PDF uploads as a document post (checked by hand).
- Dragging an approved post on the calendar asks first and sends it for re-approval.
- Export history and re-downloads work, and `DRAFT_` previews never leave without that prefix.

## Depends on

[07](07-posts.md), [11](11-review-and-approvals.md), [13](13-architecture.md) and §14 (storage, worker, links),
§02 (storage limits).
