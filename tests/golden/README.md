# Golden renders

The render engine's golden images ([§08 Golden renders](../../docs/plan/08-render-engine.md),
[§17](../../docs/plan/17-testing.md), [§21](../../docs/plan/21-ai-design-workflow.md)): every layout × size × look ×
language, drawn with sample content and held to an image Zeus approved, pixel for pixel. They run in the `golden`
Playwright project, in CI's `services` job:

```sh
pnpm exec playwright test --project golden
```

## What is here

| File               | What it holds                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `matrix.ts`        | The cases, as data: the 200 launch cases (10 layouts × 5 sizes × 2 looks × 2 languages) and 60 hard cases, each with its id, brand and what its render is expected to report                                                                           |
| `brands.ts`        | The three made-up sample brands (Kathgolap Books, Tidewell Dental, Chaka Cycle Works): palettes, fonts from the font manifest, and the palette that fails contrast                                                                                      |
| `assets.ts`        | Their logos, placeholder photos and mascot, drawn in code as SVG (shapes only, no text, nothing linked)                                                                                                                                                |
| `content.ts`       | A slide per launch layout in English and in Bangla, each written on its own; the longest allowed text; the Bangla conjuncts text; the English slide with Bangla in it                                                                                   |
| `golden.spec.ts`   | Renders each case twice, in two render browsers, through the real `renderSlide`; checks the two are the same bytes and the expected outcome; compares with the baseline exactly                                                                         |
| `pdf.spec.ts`      | A sample carousel's PDF (`renderDocument`): each page matches its slide's JPEG                                                                                                                                                                         |
| `png.ts`           | The exact comparison: every channel of every pixel, no tolerance (Playwright's own comparison skips anti-aliased pixels), and a diff image                                                                                                             |
| `matrix.spec.ts`   | Checks the matrix without a browser: the count is 200, the 560 extension, the content is valid and clean, the hard cases hold what they say                                                                                                             |
| `baselines/`       | The approved images, `baselines/golden.spec.ts/<case id>.png`. **Only Athena commits them, after Zeus's look** (changing a golden needs Zeus, §21)                                                                                                       |

A case id is `<layout>-<size>-<look>-<lang>` (`cover-portrait-clean-en`); a hard case's starts with
`hard-<kind>-` (`hard-longest-list-landscape-playful-bn`).

## What a run reports

- **Passed:** both renders are the same bytes, the outcome is the expected one, and the image equals its baseline.
- **Failed:** the two renders differ, the outcome is wrong (a fallback font, a blocked image or a contrast warning
  where none is expected, or none where one is), or a pixel differs from the baseline. On a pixel difference the test
  attaches `before` (the baseline), `after` (this render) and `diff` (the render faded to grey, each differing pixel in
  red); they are in the `golden-output` artifact and the HTML report.
- **Skipped, "no baseline yet":** the case has no approved image. Its two renders and its outcome were still checked;
  it is reported as skipped rather than passed or failed, so a missing baseline is visible.

Each test also notes what the fit check said (`pass` or `fail`, its `k`, the fields over) and what the contrast check
shaded. The longest-text cases are expected to go over: they show what the fit check does at the edge.

## Making new baselines (Athena's workflow)

With `GOLDEN_UPDATE=1` the spec compares nothing. Every case is still rendered twice and checked for identical bytes
and the expected outcome, and then its render is written to **`tests/golden-output/new/`**:

```text
tests/golden-output/new/cover-portrait-clean-en.png
tests/golden-output/new/cover-portrait-clean-en.txt   cover-portrait-clean-en renderer 1
```

Each image has a one-line sidecar: its case id and the renderer version (`RENDERER_VERSION` in
`packages/render/src/output/key.ts`) that drew it.

Athena's baseline workflow (its own task, after this one) uses it like this:

1. It runs the golden project with `GOLDEN_UPDATE=1` in the pinned Docker image, the same image as production and as
   CI's golden runs, so the pixels are the ones CI will compare against.
2. It uploads `tests/golden-output/` as the `golden-output` artifact. The new images go to Zeus with the current
   baselines and the differences (§08: the PR shows before, after and the difference).
3. After Zeus approves, it copies each approved `new/<id>.png` to `tests/golden/baselines/golden.spec.ts/<id>.png`,
   checks that every sidecar names that case and the current renderer version, and opens the baseline PR. The
   sidecars are not committed.

A builder never writes `baselines/`: a changed render shows up as a failed golden test, and the new images come from
this workflow.

## The full set: 560 (M8)

`casesFor(LAYOUT_NAMES, LOOK_NAMES)` in `matrix.ts` is the full matrix of 560 cases (14 layouts × 5 sizes × 4 looks ×
2 languages). When M8 adds testimonial, photocard, meme and beforeafter and the Bold and Editorial looks, each new layout
gets its sample content in `content.ts` (both languages, each written natively) and its brand in `BRAND_OF`, each new
look its contrast check in `CONTRAST`, and `LAUNCH_LAYOUTS` and `LAUNCH_LOOKS` grow to the full lists. The
`matrix.spec.ts` count then moves from 200 to 560, and the new cases are skipped as "no baseline yet" until Athena's
workflow makes their baselines.
