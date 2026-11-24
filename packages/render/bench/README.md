# Render speed and memory benchmark

§08 sets two numbers for the renderer: **95% of slide renders within 1.5 s per size on the production server** (so a
12-post batch of about 120 slide renders takes 2–3 minutes on one worker), and **1,000 renders in a row don't grow
memory** (the browser restarts every 500 renders and whenever its memory passes its limit). §14 sizes the server from
what this prints, and a leak shows here before launch.

It renders through the real path: `createRenderer` and `renderSlide` (the worker's own), in the pinned Chromium with the
fixed flags, one slide after another.

## What it renders

The sample batch (`batch.ts`): **12 posts × 2 slides × 5 sizes = 120 slide renders**. The posts are English and Bangla in
the Clean and Playful looks (3 of each), their slides run through 11 layouts, and the text is the layout specs' sample
content (made-up brands). A 1600 px photo and a mascot are made in memory (`assets.ts`), so there are real pictures to
decode. A run longer than 120 renders starts the batch again.

## Run it on the Picasso Mac

```sh
pnpm install
pnpm exec playwright install chromium   # only if the browser isn't there yet
node packages/render/bench/main.ts
```

It takes a few minutes. Close other apps and plug the Mac in first, and run it twice: the first run warms the disk.

Memory is read from the browser's own processes, with `/proc` on Linux and `ps` on the Mac, summed over all of them
(the browser, the GPU process, the utilities and the renderers).

### What to send back

Paste everything it prints, from the first line (the machine) to the last (the build):

| What | Where in the output |
|---|---|
| p50, p95 and max per slide, per size, in ms | the table, one row per size |
| total time | `total time` |
| peak and final memory of the browser | `peak memory`, `final memory` |
| number of browser restarts | `browser restarts` |
| the machine and the browser | the first line, and `browser build` |

The table leaves out the renders that started a browser (the first, and one after each restart) and says how long the
slowest of them took, so Chromium's launch time doesn't decide the percentiles. `total time` adds up every render,
those included, and so is what the batch took on one page at a time.

A size is marked `within` the 1.5 s target when its p95 is at or under it, and `over` when not. That is a note: the
command doesn't fail on it, since the target is for the production server and §14 makes the call.

## The soak

```sh
LZP_RENDER_SOAK=1 node packages/render/bench/main.ts
```

1,000 renders in a row at §08's own limit of 500 renders per browser, so the browser restarts once. It reads the
browser's memory after every render, and just before each browser closes. It **fails (exit code 1)** when the memory
after the last render is more than **25% above the memory after the first 50 renders**, and prints a `soak: PASS` or
`soak: FAIL` line. It also fails when no memory could be read, or the run was shorter than 50 renders, so a broken
probe is never a pass. Send back the same output, with that line.

**Why 25%, and why from the 50th render.** The first renders fill Chromium's caches (fonts, glyphs, the allocator's
arenas), so memory after render 1 is no baseline; by the 50th render the caches are warm. After that, a browser that
doesn't leak stays level, give or take the allocator: some tens of megabytes on a few hundred. A leak adds up: even
0.2 MB per render is 90 MB over the 450 renders between the 50th and the last, more than a quarter of a baseline in the
hundreds of megabytes. So 25% is wide enough not to fail on noise and narrow enough to catch a leak that would matter
within a browser's 500-render life. It is a **starting value**: the first run on the Mac should show how much a healthy
browser moves, and `SOAK_MARGIN` in `config.ts` is the one place to change it (with this paragraph).

The last reading is of the browser that did renders 501–1000, just before it closed, so it is the memory at the end
of a browser's longest life. Memory that falls back after the restart is not hidden by the check.

## The short version in CI

`tests/render/bench.spec.ts` (the `render` Playwright project, CI's `services` job; never the soak, which is off in
CI) renders 50 slides with the browser's restart count lowered to 20, and checks that:

- p95 is under `CI_P95_CEILING_MS`, **6 s**, the loose ceiling in `config.ts`. A shared CI runner is slower and noisier
  than the production server, so this only catches a render gone wrong, not a miss of the 1.5 s target;
- the browser started three times (at render 1, 21 and 41): it restarted at the lowered limit;
- the memory could be read.

The report goes to the CI log and, as `render-bench.txt`, to the `render-output` artifact.

## Where the numbers are

Every number the benchmark is judged by is in `config.ts`: `TARGET_P95_MS` (1.5 s), `CI_P95_CEILING_MS`, the CI run's
50 renders and its limit of 20, the soak's 1,000 renders, its baseline of 50 and `SOAK_MARGIN`. The renderer's own limits
(500 renders, the memory limit) are `RENDER_LIMITS` in `src/browser/limits.ts`; this benchmark doesn't change them.

## What it doesn't do

Pick the server size (§14), tune the 4 parallel pages (it renders one at a time), or fix a slow layout: a slow size or
layout in the table comes back as its own task.
