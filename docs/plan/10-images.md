# Section 10: Images (Approved 2026-11-06)

> **Stack:** decided in [§13](13-architecture.md) (approved 2026-11-06). Where this doc differs, §13 wins.

**Goal:** where the images in posts come from, how they are picked, cropped and cleaned up, and how licences,
consent and credits are kept, at launch and right after.

## Questions for Zeus (answered 2026-11-06)

| Question | Answer |
|---|---|
| Photo editing at launch? | **Crop and focus point** only; anything more in the agency's own photo app |
| Product cutouts (background removal)? | **At launch, running on our own server** with an open-source model (no per-image fee) |
| Can clients upload photos through the review link? | **Yes, at launch** (changes §01's scope; §01 and §04 updated) |
| May AI images show people (after launch)? | **Decide when AI images are planned** |

## Spec

### Where images come from

| Source | When | Notes |
|---|---|---|
| **Brand library** (agency uploads) | launch | the asset library in §06 |
| **Photos from the client** (review link) | launch | land as "waiting" until the agency approves them |
| **Product cutouts** | launch | made in the app from library photos |
| **Type-only layouts** | launch | when no photo fits |
| Stock search (Pexels, then Unsplash) | right after launch | credit and licence recorded |
| AI image generation | after launch | provider in `config/providers.ts`, counted against the plan, labelled synthetic; **people policy decided then** |

### Picking images for a post

- `pickImages` (§09) matches each slide's image request to the library's descriptions and tags.
- It skips photos that are waiting for approval or need a consent tick, and avoids reusing a photo the brand posted in
  the last 14 days, unless an editor picks it on purpose.
- If nothing fits, the slide uses a type-only layout and the editor shows "Add a photo".
- The editor's image picker: Library · From the client (approved only) · Type only · Stock and Generate (marked "after launch").

### Crop and focus

- Every photo has a **focus point**: set automatically from what the AI sees (the main subject or faces), and dragged by
  the editor.
- Each size's crop (4:5, 1:1, 9:16, 16:9, 2:3) is computed from the focus point, and the editor can override any one.
- **Resolution check:** a crop may be enlarged up to 1.25×; beyond that the editor sees "This photo is too small for
  this size" and can pick another photo or another crop.

### Product cutouts

- In the editor or the library, **"Cut out the background"** on a photo makes a new asset (a PNG with transparency) linked
  to the original, marked "cutout". The editor accepts it or tries again; there is no brush tool at launch.
- **Model:** open source, run in our worker, with a licence that allows commercial use (for example BiRefNet or
  U²-Net through rembg, chosen and its licence recorded at build time). **Not BRIA's RMBG models**, whose licence is non-commercial.
  The model is a dependency, so adding it is a `sensitive` change (§20).
- About 5–15 seconds per photo on the server's processor, at most 2 at a time. Its memory needs go into §14's server sizing.
- Used most in offer, cover and stat layouts: the looks place a cutout on the brand's color with a soft shadow. The QC
  check (vision) warns about rough edges or missing parts.

### Photos from the client

- The review page has an **"Add photos"** card: up to 20 photos per visit, 20 MB each, JPG, PNG or HEIC (iPhone,
  converted), each with an optional note ("new item: mango lassi").
- They land in the brand's library as **"From the client · waiting"** and can't be used until an agency editor
  approves them and ticks consent for any recognisable people. The Inbox shows "Rafiq sent 6 photos".
- **Limits:** at most 50 photos per link per day; images only; the file type is checked from the content, not the
  name; every image is re-encoded, which removes anything hidden in the file. The client sees only what they uploaded
  themselves, never the library.

### Processing every image

Converted to sRGB, stored at most 4096 px, **location and camera data (EXIF) removed**, HEIC turned into JPEG (decoded with libheif + libde265, §13 A14), a
thumbnail made, duplicates detected (perceptual hash). Storage counts against the workspace's plan (§02).

### Licences, consent and credits

Every asset records its source (own photo · from the client · cutout of another asset · stock later · AI later), a credit
line and a licence. Recognisable people need a consent tick before use (§22). Photo cards show the credit; exports
include credits where a licence requires them; the AI flag is carried into the export.

## Not in the MVP

Filters and light adjustments · a brush to refine cutouts · video and GIF · AI upscaling · stock search and AI
generation (both right after launch).

## Done when

- Library photos, client photos and cutouts work in all five sizes, with focus points and the resolution warning.
- A client uploads photos through the review link, they wait for agency approval, and only then can posts use them.
- The cutout model's licence is recorded, and it runs within its time and memory budget.
- EXIF removal and file-type checks are tested with crafted files.

## Depends on

[06](06-brand-kits.md) (asset library), [07](07-posts.md), [09](09-ai-pipeline.md) (`pickImages`, `tagAsset`), §11 (review
page), [13](13-architecture.md) and §14 (worker, storage, server size), §16 (consent, licences), [22](22-product-ai-guardrails.md).
