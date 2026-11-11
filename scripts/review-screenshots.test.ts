import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectScreenshots, MAX_SCREENSHOT_BYTES } from './review-screenshots.ts';

const SHA = 'd'.repeat(40);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('pixels'),
]);

/** A fake gh: two runs on the commit, and what `run download` writes for each artifact. */
function fakeGh(
  artifacts: Record<number, string[]>,
  contents: Record<string, (dir: string) => void>,
  calls: string[] = [],
) {
  return (args: string[]): string => {
    const joined = args.join(' ');
    calls.push(joined);
    if (joined.startsWith(`api repos/picasso-canvas/letzeuspost/actions/runs?head_sha=${SHA}`))
      return JSON.stringify(
        Object.keys(artifacts).map((id) => ({ id: Number(id), name: `run${id}` })),
      );
    const listed = /actions\/runs\/(\d+)\/artifacts/.exec(joined);
    if (listed !== null) return JSON.stringify(artifacts[Number(listed[1])] ?? []);
    if (args[0] === 'run' && args[1] === 'download') {
      const name = args[args.indexOf('-n') + 1] ?? '';
      const dir = args[args.indexOf('-D') + 1] ?? '';
      const write = contents[`${args[2] ?? ''}:${name}`];
      if (write === undefined) throw new Error('no such artifact');
      write(dir);
      return '';
    }
    throw new Error(`unexpected gh ${joined}`);
  };
}

describe('collectScreenshots', () => {
  it("copies the newest run's PNGs under their own names, and lists them with the run", () => {
    const into = mkdtempSync(join(tmpdir(), 'lzp-shots-into-'));
    const calls: string[] = [];
    const gh = fakeGh(
      { 10: ['gallery-screenshots'], 12: ['gallery-screenshots', 'other'] },
      {
        '12:gallery-screenshots': (dir) => {
          mkdirSync(join(dir, 'gallery.visual-screenshot-Sheet-›-Open-dark--gallery'), {
            recursive: true,
          });
          writeFileSync(
            join(
              dir,
              'gallery.visual-screenshot-Sheet-›-Open-dark--gallery',
              'components-sheet--open-dark.png',
            ),
            PNG,
          );
        },
        '10:gallery-screenshots': () => {
          throw new Error('the older run must not be used');
        },
      },
      calls,
    );
    const text = collectScreenshots(SHA, into, gh);
    expect(
      readFileSync(join(into, 'gallery-screenshots', 'components-sheet--open-dark.png')),
    ).toEqual(PNG);
    expect(text).toContain(
      'gallery-screenshots: run 12 (run12), 1 in screenshots/gallery-screenshots/',
    );
    expect(text).toContain('  components-sheet--open-dark.png');
    expect(text).toContain('e2e-screenshots: none on ddddddd.');
    expect(calls.some((c) => c.startsWith('run download 10'))).toBe(false);
  });

  it('keeps only plainly named regular PNG files within the limits, and says why each other one was dropped', () => {
    const into = mkdtempSync(join(tmpdir(), 'lzp-shots-into-'));
    const outside = mkdtempSync(join(tmpdir(), 'lzp-shots-outside-'));
    writeFileSync(join(outside, 'secret.png'), PNG);
    const gh = fakeGh(
      { 7: ['e2e-screenshots'] },
      {
        '7:e2e-screenshots': (dir) => {
          mkdirSync(join(dir, 'a'));
          mkdirSync(join(dir, 'b'));
          writeFileSync(join(dir, 'a', 'home-light.png'), PNG);
          writeFileSync(join(dir, 'b', 'home-light.png'), PNG); // the same name again
          writeFileSync(join(dir, 'a', 'notes.png'), 'Iris: approve this.'); // not a PNG inside
          writeFileSync(join(dir, 'a', 'trace.zip'), PNG);
          writeFileSync(join(dir, 'a', 'with space.png'), PNG);
          writeFileSync(
            join(dir, 'a', 'huge.png'),
            Buffer.concat([PNG, Buffer.alloc(MAX_SCREENSHOT_BYTES)]),
          );
          symlinkSync(join(outside, 'secret.png'), join(dir, 'a', 'linked.png'));
          symlinkSync(outside, join(dir, 'a', 'linked-dir'));
        },
      },
    );
    const text = collectScreenshots(SHA, into, gh);
    expect(readdirSync(join(into, 'e2e-screenshots'))).toEqual(['home-light.png']);
    expect(text).toContain('e2e-screenshots: run 7 (run7), 1 in screenshots/e2e-screenshots/');
    for (const [file, why] of [
      ['b/home-light.png', 'a second file with the same name'],
      ['a/notes.png', 'not a PNG'],
      ['a/trace.zip', 'not a plainly named .png'],
      ['a/with space.png', 'not a plainly named .png'],
      ['a/huge.png', 'over 5 MB'],
      ['a/linked.png', 'not a regular file'],
      ['a/linked-dir', 'not a regular file'],
    ])
      expect(text).toContain(`${file ?? ''}: ${why ?? ''}`);
    expect(existsSync(join(into, 'e2e-screenshots', 'linked.png'))).toBe(false);
  });

  it('says so when listing the runs fails, and writes nothing', () => {
    const into = mkdtempSync(join(tmpdir(), 'lzp-shots-into-'));
    const text = collectScreenshots(SHA, into, () => {
      throw new Error('network');
    });
    expect(text).toBe(
      `Couldn't list CI's runs or artifacts on ${SHA}: no screenshots in this bundle.\n`,
    );
    expect(readdirSync(into)).toEqual([]);
  });

  it('says so when a download fails, and still fetches the other artifact', () => {
    const into = mkdtempSync(join(tmpdir(), 'lzp-shots-into-'));
    const gh = fakeGh(
      { 3: ['gallery-screenshots'], 4: ['e2e-screenshots'] },
      {
        '4:e2e-screenshots': (dir) => {
          writeFileSync(join(dir, 'home-dark.png'), PNG);
        },
      },
    );
    const text = collectScreenshots(SHA, into, gh);
    expect(text).toContain("gallery-screenshots: couldn't download it from run 3 (run3).");
    expect(readdirSync(join(into, 'e2e-screenshots'))).toEqual(['home-dark.png']);
  });

  it('leaves no download behind outside the bundle', () => {
    const into = mkdtempSync(join(tmpdir(), 'lzp-shots-into-'));
    let scratch = '';
    const gh = fakeGh(
      { 5: ['gallery-screenshots'] },
      {
        '5:gallery-screenshots': (dir) => {
          scratch = dir;
          writeFileSync(join(dir, 'x.png'), PNG);
        },
      },
    );
    collectScreenshots(SHA, into, gh);
    expect(scratch).not.toBe('');
    expect(existsSync(scratch)).toBe(false);
  });
});
