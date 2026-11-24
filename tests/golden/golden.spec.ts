import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { SIZES } from '../../packages/core/src/index.ts';
import {
  createRenderer,
  PAGE_ORIGIN,
  type Renderer,
} from '../../packages/render/src/browser/index.ts';
import { RENDERER_VERSION } from '../../packages/render/src/output/key.ts';
import { renderPostSlide, type RenderedSlide } from '../render/slides.ts';
import { GOLDEN_CASES, caseInput, type CaseInput, type GoldenCase } from './matrix.ts';
import { comparePng, decodePng } from './png.ts';

// The golden renders (§08 Golden renders, §17, §21): every case of the matrix (`matrix.ts`: the 200 launch cases and
// the hard cases) drawn through the real `renderSlide`, in the real looks and fonts, and held to its approved image in
// tests/golden/baselines/golden.spec.ts/<case id>.png with no tolerance: one channel of one pixel off is a failure,
// and the before, the after and the difference are attached for Zeus. Each case is drawn twice, in two separate
// render browsers, and the two must be the same bytes (§08: two runs give identical pixels).
//
// A case with no approved image yet is reported as skipped, "no baseline yet", after its two renders have been drawn
// and checked: it neither passes nor fails. With GOLDEN_UPDATE=1 nothing is compared: each render is written to
// tests/golden-output/new/ with a one-line sidecar, for Athena's baseline workflow (README.md). Only Athena commits
// baselines, after Zeus's look.

/** Where GOLDEN_UPDATE=1 writes new images: inside the golden project's output folder, which CI uploads. */
const NEW_IMAGES = fileURLToPath(new URL('../golden-output/new/', import.meta.url));
const updating = process.env.GOLDEN_UPDATE === '1';

let renderers: [Renderer, Renderer] | undefined;

test.beforeAll(() => {
  // Two render browsers, each started on its first render: every case is drawn once in each.
  renderers = [createRenderer({ log: () => undefined }), createRenderer({ log: () => undefined })];
});

test.afterAll(async () => {
  await Promise.all((renderers ?? []).map((renderer) => renderer.close()));
  renderers = undefined;
});

/** The case drawn once in each render browser. */
async function drawTwice(
  golden: GoldenCase,
  input: CaseInput,
): Promise<[RenderedSlide, RenderedSlide]> {
  if (renderers === undefined) throw new Error('no render browsers');
  const draw = (renderer: Renderer) =>
    renderPostSlide(renderer, input.post, golden.size, input.assets, 0, input.kit);
  const first = await draw(renderers[0]);
  const second = await draw(renderers[1]);
  return [first, second];
}

/**
 * What a render measured, to hold two renders equal: the requests in a fixed order (the page fetches its fonts and
 * images in parallel, so the order they arrive in is not part of the result).
 */
const measured = ({ render }: RenderedSlide) => ({
  ...render,
  served: render.served.toSorted(),
  blocked: render.blocked.map((request) => `${request.type} ${request.url}`).toSorted(),
});

/** What every render of the case must report: a fallback font, blocked images and build warnings only where expected. */
function expectOutcome(golden: GoldenCase, input: CaseInput, drawn: RenderedSlide): void {
  const { width, height } = SIZES[golden.size];
  const image = decodePng(drawn.png);
  expect([image.width, image.height], 'the size').toEqual([width, height]);
  expect(drawn.warnings, 'build warnings').toEqual([]);

  const errors = drawn.render.errors;
  if (input.expected.fontFallback) {
    // §08 No silent fallbacks: Bangla drawn by a font the page didn't load is reported, never hidden.
    expect(errors.length, 'the fallback error').toBeGreaterThan(0);
    expect(new Set(errors.map((error) => error.code))).toEqual(new Set(['font-fallback']));
  } else {
    expect(errors, 'fallback fonts').toEqual([]);
  }

  // The missing photo is asked for at its asset address and blocked; nothing else is.
  const blocked = new Set(drawn.render.blocked.map((request) => request.url));
  expect(blocked, 'blocked requests').toEqual(
    new Set(input.expected.blocked.map((key) => `${PAGE_ORIGIN}/image/${key}`)),
  );

  if (input.expected.contrastShaded) expect(input.contrast.warnings.length).toBeGreaterThan(0);
  else expect(input.contrast.warnings).toEqual([]);
  expect(input.contrast.failures, 'contrast pairs still failing').toEqual([]);
}

/** Notes for the report: what the fit check said and what the contrast check shaded. */
function annotate(input: CaseInput, drawn: RenderedSlide): void {
  const { status, k, fields } = drawn.report;
  const over = fields.filter((field) => field.overflowPx > 0).map((field) => field.field);
  test.info().annotations.push({
    type: 'fit',
    description: `${status}, k ${String(k)}${over.length > 0 ? `, over: ${over.join(', ')}` : ''}`,
  });
  for (const warning of input.contrast.warnings)
    test.info().annotations.push({
      type: 'contrast',
      description: `${warning.look}: ${warning.colour} ${warning.from} → ${warning.to}`,
    });
}

for (const golden of GOLDEN_CASES) {
  test(golden.id, async () => {
    const input = caseInput(golden);
    const [first, second] = await drawTwice(golden, input);

    // Two runs, the same bytes: the image and everything the render measured.
    expect(Buffer.from(second.png).equals(Buffer.from(first.png)), 'the two renders differ').toBe(
      true,
    );
    expect(second.report).toEqual(first.report);
    expect(measured(second)).toEqual(measured(first));
    expectOutcome(golden, input, first);
    annotate(input, first);

    if (updating) {
      await mkdir(NEW_IMAGES, { recursive: true });
      await writeFile(`${NEW_IMAGES}${golden.id}.png`, first.png);
      await writeFile(
        `${NEW_IMAGES}${golden.id}.txt`,
        `${golden.id} renderer ${String(RENDERER_VERSION)}\n`,
      );
      return;
    }

    const baseline = test.info().snapshotPath(`${golden.id}.png`);
    // No approved image for this case yet (Athena commits them after Zeus's look): reported, neither passed nor failed.
    test.skip(!existsSync(baseline), 'no baseline yet');

    const result = comparePng(await readFile(baseline), first.png);
    if (!result.equal) {
      const before = test.info().outputPath('before.png');
      const after = test.info().outputPath('after.png');
      await writeFile(before, await readFile(baseline));
      await writeFile(after, first.png);
      await test.info().attach('before', { path: before, contentType: 'image/png' });
      await test.info().attach('after', { path: after, contentType: 'image/png' });
      if (result.diff !== undefined) {
        const diff = test.info().outputPath('diff.png');
        await writeFile(diff, result.diff);
        await test.info().attach('diff', { path: diff, contentType: 'image/png' });
      }
    }
    expect(
      result.size ?? `${String(result.differing)} pixels differ`,
      'against the approved image',
    ).toBe('0 pixels differ');
  });
}
