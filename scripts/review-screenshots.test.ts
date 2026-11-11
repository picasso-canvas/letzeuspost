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
import {
  collectScreenshots,
  MAX_ARTIFACT_BYTES,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOTS,
} from './review-screenshots.ts';

const SHA = 'd'.repeat(40);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('pixels'),
]);

interface FakeArtifact {
  name: string;
  expired?: boolean;
  size_in_bytes?: number;
}

interface FakeRun {
  artifacts: (string | FakeArtifact)[];
  path?: string;
  event?: string;
}

/** The workflow that uploads each artifact, as CI does (design.yml, services.yml). */
const WORKFLOW: Record<string, string> = {
  'gallery-screenshots': '.github/workflows/design.yml',
  'e2e-screenshots': '.github/workflows/services.yml',
};

/**
 * A fake gh: the runs on the commit (each from the workflow that uploads its first artifact, on pull_request, unless
 * said otherwise), their artifacts, and what `run download` writes for each.
 */
function fakeGh(
  runs: Record<number, FakeRun>,
  contents: Record<string, (dir: string) => void>,
  calls: string[] = [],
) {
  const artifactsOf = (run: FakeRun) =>
    run.artifacts.map((a) => ({
      expired: false,
      size_in_bytes: 1000,
      ...(typeof a === 'string' ? { name: a } : a),
    }));
  return (args: string[]): string => {
    const joined = args.join(' ');
    calls.push(joined);
    if (joined.startsWith(`api repos/picasso-canvas/letzeuspost/actions/runs?head_sha=${SHA}`))
      return JSON.stringify(
        Object.entries(runs).map(([id, run]) => {
          const first = artifactsOf(run)[0]?.name ?? '';
          return {
            id: Number(id),
            name: `run${id}`,
            path: run.path ?? WORKFLOW[first] ?? '.github/workflows/ci.yml',
            event: run.event ?? 'pull_request',
          };
        }),
      );
    const listed = /actions\/runs\/(\d+)\/artifacts/.exec(joined);
    if (listed !== null) {
      const run = runs[Number(listed[1])];
      return JSON.stringify(run === undefined ? [] : artifactsOf(run));
    }
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

const into = () => mkdtempSync(join(tmpdir(), 'lzp-shots-into-'));

describe('collectScreenshots', () => {
  it("copies the newest run's PNGs under their own names, and lists them with the run", () => {
    const out = into();
    const calls: string[] = [];
    const gh = fakeGh(
      {
        10: { artifacts: ['gallery-screenshots'] },
        12: { artifacts: ['gallery-screenshots', 'other'] },
      },
      {
        '12:gallery-screenshots': (dir) => {
          const folder = join(dir, 'gallery.visual-screenshot-Sheet-›-Open-dark--gallery');
          mkdirSync(folder, { recursive: true });
          writeFileSync(join(folder, 'components-sheet--open-dark.png'), PNG);
        },
        '10:gallery-screenshots': () => {
          throw new Error('the older run must not be used');
        },
      },
      calls,
    );
    const text = collectScreenshots(SHA, out, gh);
    expect(
      readFileSync(join(out, 'gallery-screenshots', 'components-sheet--open-dark.png')),
    ).toEqual(PNG);
    expect(text).toContain(
      'gallery-screenshots: run 12 (run12), 1 in screenshots/gallery-screenshots/',
    );
    expect(text).toContain('  components-sheet--open-dark.png');
    expect(text).toContain('e2e-screenshots: none on ddddddd.');
    expect(calls.some((c) => c.startsWith('run download 10'))).toBe(false);
  });

  it('keeps only plainly named regular PNG files within the limits, and says why each other one was dropped', () => {
    const out = into();
    const outside = mkdtempSync(join(tmpdir(), 'lzp-shots-outside-'));
    writeFileSync(join(outside, 'secret.png'), PNG);
    const gh = fakeGh(
      { 7: { artifacts: ['e2e-screenshots'] } },
      {
        '7:e2e-screenshots': (dir) => {
          mkdirSync(join(dir, 'a'));
          writeFileSync(join(dir, 'a', 'home-light.png'), PNG);
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
    const text = collectScreenshots(SHA, out, gh);
    expect(readdirSync(join(out, 'e2e-screenshots'))).toEqual(['home-light.png']);
    expect(text).toContain('e2e-screenshots: run 7 (run7), 1 in screenshots/e2e-screenshots/');
    for (const [file, why] of [
      ['a/notes.png', 'not a PNG'],
      ['a/trace.zip', 'not a plainly named .png'],
      ['a/with space.png', 'not a plainly named .png'],
      ['a/huge.png', 'over 5 MB'],
      ['a/linked.png', 'not a regular file'],
      ['a/linked-dir', 'not a regular file'],
    ])
      expect(text).toContain(`${file ?? ''}: ${why ?? ''}`);
    expect(existsSync(join(out, 'e2e-screenshots', 'linked.png'))).toBe(false);
  });

  // Argus F1 on #213: the app-light and app-dark projects write the same file names, each in its own folder.
  it('keeps both of two files with the same name, each named after its folder, and says which is which', () => {
    const out = into();
    const gh = fakeGh(
      { 8: { artifacts: ['e2e-screenshots'] } },
      {
        '8:e2e-screenshots': (dir) => {
          for (const folder of ['home-placeholder-app-light', 'home-placeholder-app-dark']) {
            mkdirSync(join(dir, folder));
            writeFileSync(join(dir, folder, 'home-actual.png'), PNG);
          }
          mkdirSync(join(dir, 'other-app-light'));
          writeFileSync(join(dir, 'other-app-light', 'unique.png'), PNG);
        },
      },
    );
    const text = collectScreenshots(SHA, out, gh);
    expect(readdirSync(join(out, 'e2e-screenshots')).sort()).toEqual([
      'home-placeholder-app-dark__home-actual.png',
      'home-placeholder-app-light__home-actual.png',
      'unique.png',
    ]);
    expect(text).toContain('3 in screenshots/e2e-screenshots/');
  });

  // Cerberus F3 on #213: the bundle sits on a case-insensitive disk, where Home.png would overwrite home.png.
  it('treats names that differ only in case as the same name', () => {
    const out = into();
    const gh = fakeGh(
      { 9: { artifacts: ['gallery-screenshots'] } },
      {
        '9:gallery-screenshots': (dir) => {
          mkdirSync(join(dir, 'a'));
          mkdirSync(join(dir, 'b'));
          writeFileSync(join(dir, 'a', 'Home.png'), PNG);
          writeFileSync(join(dir, 'b', 'home.png'), PNG);
        },
      },
    );
    collectScreenshots(SHA, out, gh);
    expect(readdirSync(join(out, 'gallery-screenshots')).sort()).toEqual([
      'a__Home.png',
      'b__home.png',
    ]);
  });

  it(`stops at ${String(MAX_SCREENSHOTS)} files, and says so for each one past the limit`, () => {
    const out = into();
    const gh = fakeGh(
      { 11: { artifacts: ['gallery-screenshots'] } },
      {
        '11:gallery-screenshots': (dir) => {
          for (let i = 0; i <= MAX_SCREENSHOTS; i++)
            writeFileSync(join(dir, `s${String(i).padStart(4, '0')}.png`), PNG);
        },
      },
    );
    const text = collectScreenshots(SHA, out, gh);
    expect(readdirSync(join(out, 'gallery-screenshots'))).toHaveLength(MAX_SCREENSHOTS);
    expect(text).toContain(
      `s${String(MAX_SCREENSHOTS).padStart(4, '0')}.png: past the limit of ${String(MAX_SCREENSHOTS)}`,
    );
  });

  // Cerberus F1 and Argus F2 on #213: the PR's code decides the artifact's size, so it is checked before downloading.
  it('never downloads an artifact over the size limit, and says so', () => {
    const out = into();
    const calls: string[] = [];
    const gh = fakeGh(
      {
        13: { artifacts: [{ name: 'gallery-screenshots', size_in_bytes: MAX_ARTIFACT_BYTES + 1 }] },
      },
      {},
      calls,
    );
    const text = collectScreenshots(SHA, out, gh);
    expect(calls.some((c) => c.startsWith('run download'))).toBe(false);
    expect(text).toContain(
      'gallery-screenshots: run 13 (run13) holds 200.0 MB, over the 200 MB limit: not downloaded.',
    );
  });

  it('skips an expired artifact for an older one that is still there', () => {
    const out = into();
    const gh = fakeGh(
      {
        20: { artifacts: ['gallery-screenshots'] },
        21: { artifacts: [{ name: 'gallery-screenshots', expired: true }] },
      },
      {
        '20:gallery-screenshots': (dir) => {
          writeFileSync(join(dir, 'kept.png'), PNG);
        },
      },
    );
    expect(collectScreenshots(SHA, out, gh)).toContain('gallery-screenshots: run 20 (run20)');
  });

  // Cerberus F2 on #213: the screenshots Iris sees come from the workflow that renders them, on the PR.
  it('takes each artifact only from its own workflow, on a pull_request run', () => {
    const out = into();
    const calls: string[] = [];
    const gh = fakeGh(
      {
        30: { artifacts: ['gallery-screenshots'] },
        31: { artifacts: ['gallery-screenshots'], path: '.github/workflows/ci.yml' },
        32: { artifacts: ['gallery-screenshots'], event: 'workflow_dispatch' },
        33: { artifacts: ['e2e-screenshots'], path: '.github/workflows/design.yml' },
      },
      {
        '30:gallery-screenshots': (dir) => {
          writeFileSync(join(dir, 'kept.png'), PNG);
        },
      },
      calls,
    );
    const text = collectScreenshots(SHA, out, gh);
    expect(text).toContain('gallery-screenshots: run 30 (run30)');
    expect(text).toContain('e2e-screenshots: none on ddddddd.');
    expect(calls.filter((c) => c.startsWith('run download'))).toEqual([
      expect.stringMatching(/^run download 30 /) as unknown as string,
    ]);
  });

  it('says so when listing the runs fails, and writes nothing', () => {
    const out = into();
    const text = collectScreenshots(SHA, out, () => {
      throw new Error('network');
    });
    expect(text).toBe(
      `Couldn't list CI's runs or artifacts on ${SHA}: no screenshots in this bundle.\n`,
    );
    expect(readdirSync(out)).toEqual([]);
  });

  it('says so when a download fails, and still fetches the other artifact', () => {
    const out = into();
    const gh = fakeGh(
      { 3: { artifacts: ['gallery-screenshots'] }, 4: { artifacts: ['e2e-screenshots'] } },
      {
        '4:e2e-screenshots': (dir) => {
          writeFileSync(join(dir, 'home-dark.png'), PNG);
        },
      },
    );
    const text = collectScreenshots(SHA, out, gh);
    expect(text).toContain("gallery-screenshots: couldn't download it from run 3 (run3).");
    expect(readdirSync(join(out, 'e2e-screenshots'))).toEqual(['home-dark.png']);
  });

  it('leaves no download behind outside the bundle', () => {
    const out = into();
    let scratch = '';
    const gh = fakeGh(
      { 5: { artifacts: ['gallery-screenshots'] } },
      {
        '5:gallery-screenshots': (dir) => {
          scratch = dir;
          writeFileSync(join(dir, 'x.png'), PNG);
        },
      },
    );
    collectScreenshots(SHA, out, gh);
    expect(scratch).not.toBe('');
    expect(existsSync(scratch)).toBe(false);
  });
});
