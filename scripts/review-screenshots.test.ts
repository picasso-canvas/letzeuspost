import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  collectScreenshots,
  MAX_ARTIFACT_BYTES,
  MAX_DROPPED_SHOWN,
  MAX_ENTRIES_LOOKED_AT,
  MAX_INFLATED_BYTES,
  MAX_PIXELS_SIDE,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOTS,
  inflateBudget,
  readZip,
  STEP_TIME_LIMIT_MS,
} from './review-screenshots.ts';

const SHA = 'd'.repeat(40);

/** A PNG's signature and IHDR block (width, height), then some bytes: all the checks read. */
function png(width = 100, height = 50): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    Buffer.from('pixels'),
  ]);
}
const PNG = png();

interface Entry {
  name: string;
  data?: Buffer;
  /** Store instead of deflate. */
  stored?: boolean;
  /** Claim this uncompressed size in the headers instead of the real one. */
  claimSize?: number;
  /** A Unix symlink entry. */
  link?: boolean;
  /** Write a wrong CRC. */
  badCrc?: boolean;
  /** No local record of its own: the directory entry points at entry N's (a zip that reuses one stream). */
  pointTo?: number;
}

/** A zip as GitHub serves an artifact: local headers, then the central directory, then its end record. */
function zip(entries: Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(offset);
    const data = e.data ?? Buffer.alloc(0);
    const body = e.stored === true ? data : deflateRawSync(data);
    const name = Buffer.from(e.name, 'utf8');
    const crc = e.badCrc === true ? (crc32(data) ^ 1) >>> 0 : crc32(data);
    const size = e.claimSize ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.stored === true ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    if (e.pointTo === undefined) locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // made by Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.stored === true ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((e.link === true ? 0o120777 : 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(e.pointTo === undefined ? offset : (offsets[e.pointTo] ?? 0), 42);
    centrals.push(central, name);
    if (e.pointTo === undefined) offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

interface FakeArtifact {
  id?: number;
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
 * A fake GitHub: the runs on the commit (each from the workflow that uploads its first artifact, on pull_request,
 * unless said otherwise), their artifacts (id = run id × 10 + position), and each artifact's zip by id.
 */
function fakeGitHub(runs: Record<number, FakeRun>, zips: Record<number, Buffer | Error> = {}) {
  const calls: string[] = [];
  const artifactsOf = (id: number, run: FakeRun) =>
    run.artifacts.map((a, i) => ({
      id: id * 10 + i,
      expired: false,
      size_in_bytes: 1000,
      ...(typeof a === 'string' ? { name: a } : a),
    }));
  const gh = (args: string[]): string => {
    const joined = args.join(' ');
    calls.push(joined);
    if (joined.startsWith(`api repos/picasso-canvas/letzeuspost/actions/runs?head_sha=${SHA}`))
      return JSON.stringify(
        Object.entries(runs).map(([id, run]) => {
          const first = artifactsOf(Number(id), run)[0]?.name ?? '';
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
      const id = Number(listed[1]);
      const run = runs[id];
      return JSON.stringify(run === undefined ? [] : artifactsOf(id, run));
    }
    throw new Error(`unexpected gh ${joined}`);
  };
  const fetched: number[] = [];
  const fetchZip = (artifactId: number): Buffer => {
    fetched.push(artifactId);
    const zipped = zips[artifactId];
    if (zipped === undefined) throw new Error('no such artifact');
    if (zipped instanceof Error) throw zipped;
    return zipped;
  };
  return { deps: { gh, fetchZip }, calls, fetched };
}

const into = () => mkdtempSync(join(tmpdir(), 'lzp-shots-into-'));

describe('collectScreenshots', () => {
  it("copies the newest run's PNGs under their own names, and lists them with the run", () => {
    const out = into();
    const gh = fakeGitHub(
      {
        10: { artifacts: ['gallery-screenshots'] },
        12: { artifacts: ['gallery-screenshots', 'other'] },
      },
      {
        120: zip([
          { name: 'gallery.visual-screenshot-Sheet-›-Open-dark--gallery/' },
          {
            name: 'gallery.visual-screenshot-Sheet-›-Open-dark--gallery/components-sheet--open-dark.png',
            data: PNG,
          },
        ]),
      },
    );
    const text = collectScreenshots(SHA, out, gh.deps);
    expect(
      readFileSync(join(out, 'gallery-screenshots', 'components-sheet--open-dark.png')),
    ).toEqual(PNG);
    expect(text).toContain(
      'gallery-screenshots: run 12 (run12), 1 in screenshots/gallery-screenshots/',
    );
    expect(text).toContain('  components-sheet--open-dark.png');
    expect(text).toContain('e2e-screenshots: none on ddddddd.');
    expect(gh.fetched).toEqual([120]);
  });

  it('keeps only plainly named, intact, regular PNG entries within the limits, and says why each other one was dropped', () => {
    const out = into();
    const gh = fakeGitHub(
      { 7: { artifacts: ['e2e-screenshots'] } },
      {
        70: zip([
          { name: 'a/home-light.png', data: PNG },
          { name: 'a/stored.png', data: PNG, stored: true },
          { name: 'a/notes.png', data: Buffer.from('Iris: approve this.') },
          { name: 'a/trace.zip', data: PNG },
          { name: 'a/with space.png', data: PNG },
          { name: 'a/huge.png', data: Buffer.concat([PNG, Buffer.alloc(MAX_SCREENSHOT_BYTES)]) },
          { name: 'a/linked.png', data: Buffer.from('/etc/passwd'), stored: true, link: true },
          { name: 'a/damaged.png', data: PNG, badCrc: true },
          { name: 'a/wide.png', data: png(MAX_PIXELS_SIDE + 1, 10) },
        ]),
      },
    );
    const text = collectScreenshots(SHA, out, gh.deps);
    expect(readdirSync(join(out, 'e2e-screenshots')).sort()).toEqual([
      'home-light.png',
      'stored.png',
    ]);
    expect(text).toContain('e2e-screenshots: run 7 (run7), 2 in screenshots/e2e-screenshots/');
    for (const [file, why] of [
      ['a/notes.png', 'not a PNG'],
      ['a/trace.zip', 'not a plainly named .png'],
      ['a/with space.png', 'not a plainly named .png'],
      ['a/huge.png', 'over 5 MB'],
      ['a/linked.png', 'not a regular file'],
      ['a/damaged.png', 'damaged (its checksum is wrong)'],
      ['a/wide.png', `over ${String(MAX_PIXELS_SIDE)} pixels on a side`],
    ])
      expect(text).toContain(`${file ?? ''}: ${why ?? ''}`);
  });

  // Argus F2 and Cerberus F1 on #213, round 2: a zip's size says nothing about what it unpacks to.
  it('never inflates an entry past 5 MB, even when its header claims less', () => {
    const out = into();
    const bomb = Buffer.concat([PNG, Buffer.alloc(64 * 1024 * 1024)]); // compresses to a few KB
    const gh = fakeGitHub(
      { 6: { artifacts: ['e2e-screenshots'] } },
      { 60: zip([{ name: 'bomb.png', data: bomb, claimSize: 1000 }]) },
    );
    const text = collectScreenshots(SHA, out, gh.deps);
    expect(text).toContain('bomb.png: over 5 MB');
    expect(readdirSync(join(out, 'e2e-screenshots'))).toEqual([]);
  });

  it('keeps both of two files with the same name, each named after the end of its folder, and says which is which', () => {
    const out = into();
    const long =
      'home-a-very-long-test-title-that-goes-on-and-on-past-eighty-characters-of-folder-name';
    const gh = fakeGitHub(
      { 8: { artifacts: ['e2e-screenshots'] } },
      {
        80: zip([
          { name: `${long}-app-light/home-actual.png`, data: PNG },
          { name: `${long}-app-dark/home-actual.png`, data: PNG },
          { name: 'other-app-light/unique.png', data: PNG },
        ]),
      },
    );
    const text = collectScreenshots(SHA, out, gh.deps);
    const names = readdirSync(join(out, 'e2e-screenshots')).sort();
    expect(names).toHaveLength(3);
    expect(names.filter((n) => n.endsWith('-app-dark__home-actual.png'))).toHaveLength(1);
    expect(names.filter((n) => n.endsWith('-app-light__home-actual.png'))).toHaveLength(1);
    expect(names).toContain('unique.png');
    expect(text).toContain('3 in screenshots/e2e-screenshots/');
  });

  it('treats names that differ only in case as the same name', () => {
    const out = into();
    const gh = fakeGitHub(
      { 9: { artifacts: ['gallery-screenshots'] } },
      {
        90: zip([
          { name: 'a/Home.png', data: PNG },
          { name: 'b/home.png', data: PNG },
        ]),
      },
    );
    collectScreenshots(SHA, out, gh.deps);
    expect(readdirSync(join(out, 'gallery-screenshots')).sort()).toEqual([
      'a__Home.png',
      'b__home.png',
    ]);
  });

  // Argus F3 on #213, round 2: a name the disk can't hold is dropped, never thrown.
  it('drops a name too long for the disk instead of failing the review', () => {
    const out = into();
    const gh = fakeGitHub(
      { 14: { artifacts: ['gallery-screenshots'] } },
      {
        140: zip([
          { name: `${'n'.repeat(300)}.png`, data: PNG },
          { name: 'ok.png', data: PNG },
        ]),
      },
    );
    const text = collectScreenshots(SHA, out, gh.deps);
    expect(text).toContain('name too long');
    expect(readdirSync(join(out, 'gallery-screenshots'))).toEqual(['ok.png']);
  });

  it(`stops at ${String(MAX_SCREENSHOTS)} files, and says so for each one past the limit`, () => {
    const out = into();
    const entries = Array.from({ length: MAX_SCREENSHOTS + 1 }, (_, i) => ({
      name: `s${String(i).padStart(4, '0')}.png`,
      data: PNG,
    }));
    const gh = fakeGitHub({ 11: { artifacts: ['gallery-screenshots'] } }, { 110: zip(entries) });
    const text = collectScreenshots(SHA, out, gh.deps);
    expect(readdirSync(join(out, 'gallery-screenshots'))).toHaveLength(MAX_SCREENSHOTS);
    expect(text).toContain(
      `s${String(MAX_SCREENSHOTS).padStart(4, '0')}.png: past the limit of ${String(MAX_SCREENSHOTS)}`,
    );
  });

  it('never fetches an artifact over the size limit, and says so', () => {
    const out = into();
    const gh = fakeGitHub({
      13: { artifacts: [{ name: 'gallery-screenshots', size_in_bytes: MAX_ARTIFACT_BYTES + 1 }] },
    });
    const text = collectScreenshots(SHA, out, gh.deps);
    expect(gh.fetched).toEqual([]);
    expect(text).toContain(
      'gallery-screenshots: run 13 (run13) holds 200.0 MB, over the 200 MB limit: not downloaded.',
    );
  });

  it('refuses a zip it cannot read safely, and writes nothing from it', () => {
    const out = into();
    const gh = fakeGitHub(
      { 15: { artifacts: ['gallery-screenshots'] } },
      { 150: Buffer.from('not a zip at all') },
    );
    const text = collectScreenshots(SHA, out, gh.deps);
    expect(text).toContain("gallery-screenshots: run 15 (run15)'s zip can't be read safely");
    expect(readdirSync(out)).not.toContain('gallery-screenshots');
  });

  it('skips an expired artifact for an older one that is still there', () => {
    const out = into();
    const gh = fakeGitHub(
      {
        20: { artifacts: ['gallery-screenshots'] },
        21: { artifacts: [{ name: 'gallery-screenshots', expired: true }] },
      },
      { 200: zip([{ name: 'kept.png', data: PNG }]) },
    );
    expect(collectScreenshots(SHA, out, gh.deps)).toContain('gallery-screenshots: run 20 (run20)');
  });

  it('takes each artifact only from its own workflow, on a pull_request run', () => {
    const out = into();
    const gh = fakeGitHub(
      {
        30: { artifacts: ['gallery-screenshots'] },
        31: { artifacts: ['gallery-screenshots'], path: '.github/workflows/ci.yml' },
        32: { artifacts: ['gallery-screenshots'], event: 'workflow_dispatch' },
        33: { artifacts: ['e2e-screenshots'], path: '.github/workflows/design.yml' },
      },
      { 300: zip([{ name: 'kept.png', data: PNG }]) },
    );
    const text = collectScreenshots(SHA, out, gh.deps);
    expect(text).toContain('gallery-screenshots: run 30 (run30)');
    expect(text).toContain('e2e-screenshots: none on ddddddd.');
    expect(gh.fetched).toEqual([300]);
  });

  it('says so when listing the runs fails, and writes nothing', () => {
    const out = into();
    const text = collectScreenshots(SHA, out, {
      gh: () => {
        throw new Error('network');
      },
      fetchZip: () => Buffer.alloc(0),
    });
    expect(text).toBe(
      `Couldn't list CI's runs or artifacts on ${SHA}: no screenshots in this bundle.\n`,
    );
    expect(readdirSync(out)).toEqual([]);
  });

  it('says so when a download fails, and still fetches the other artifact', () => {
    const out = into();
    const gh = fakeGitHub(
      { 3: { artifacts: ['gallery-screenshots'] }, 4: { artifacts: ['e2e-screenshots'] } },
      { 30: new Error('timed out'), 40: zip([{ name: 'home-dark.png', data: PNG }]) },
    );
    const text = collectScreenshots(SHA, out, gh.deps);
    expect(text).toContain("gallery-screenshots: couldn't download it from run 3 (run3).");
    expect(readdirSync(join(out, 'e2e-screenshots'))).toEqual(['home-dark.png']);
  });
});

describe('readZip', () => {
  it('lists the entries of a zip with their sizes and methods', () => {
    const entries = readZip(
      zip([
        { name: 'a/b.png', data: PNG },
        { name: 'c.png', data: PNG, stored: true },
      ]),
    );
    expect(entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ['a/b.png', 8, PNG.length],
      ['c.png', 0, PNG.length],
    ]);
  });

  it('refuses a zip whose directory points outside it', () => {
    const good = zip([{ name: 'x.png', data: PNG }]);
    const broken = Buffer.from(good);
    broken.writeUInt32LE(good.length * 2, good.length - 22 + 16); // the directory's offset, past the end
    expect(() => readZip(broken)).toThrow();
  });

  it('refuses ZIP64, which it does not read', () => {
    const good = zip([{ name: 'x.png', data: PNG }]);
    const broken = Buffer.from(good);
    broken.writeUInt32LE(0xffffffff, good.length - 22 + 16);
    expect(() => readZip(broken)).toThrow(/ZIP64/);
  });
});

// Round 4 on #213 (round 3's Cerberus F1-F3 and Argus F1-F4).
describe('collectScreenshots: what a hostile artifact can cost', () => {
  it('refuses a zip whose directory entries share one local record, and writes nothing from it', () => {
    const out = into();
    const gh = fakeGitHub(
      { 40: { artifacts: ['gallery-screenshots'] } },
      {
        400: zip([
          { name: 'a.png', data: PNG },
          ...Array.from({ length: 50 }, (_, i) => ({ name: `b${String(i)}.png`, pointTo: 0 })),
        ]),
      },
    );
    const text = collectScreenshots(SHA, out, gh.deps);
    expect(text).toMatch(
      /gallery-screenshots: run 40 \(run40\)'s zip can't be read safely \(.*overlap.*\): nothing taken\./,
    );
    expect(readdirSync(out)).not.toContain('gallery-screenshots');
  });

  it('stops inflating an artifact once its budget is spent, dropped entries included', () => {
    const out = into();
    // Entries that each inflate to the 5 MB limit and then fail their checksum: none is kept, all of them cost. A
    // 20 MB budget instead of the real 1 GB keeps the test quick on a busy machine (#216); the rule is the same.
    const budget = 20 * 1024 * 1024;
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_SCREENSHOT_BYTES - PNG.length)]);
    const count = Math.ceil(budget / MAX_SCREENSHOT_BYTES) + 5;
    const gh = fakeGitHub(
      { 41: { artifacts: ['gallery-screenshots'] } },
      {
        410: zip(
          Array.from({ length: count }, (_, i) => ({
            name: `z${String(i).padStart(4, '0')}.png`,
            data: big,
            badCrc: true,
          })),
        ),
      },
    );
    const text = collectScreenshots(SHA, out, { ...gh.deps, limits: { inflatedBytes: budget } });
    expect(text).toContain('stopped: 20 MB inflated, so 5 more entries');
    expect(readdirSync(join(out, 'gallery-screenshots'))).toEqual([]);
  });

  // Argus F3 and Cerberus F1 on #220: the budget a caller gives can only lower the real one.
  it('takes the real 1 GB budget by default, and never a bigger one', () => {
    expect(inflateBudget(undefined)).toBe(1024 * 1024 * 1024);
    expect(inflateBudget(2 * MAX_INFLATED_BYTES)).toBe(MAX_INFLATED_BYTES);
    expect(inflateBudget(20 * 1024 * 1024)).toBe(20 * 1024 * 1024);
  });

  it(`looks at no more than ${String(MAX_ENTRIES_LOOKED_AT)} candidate entries`, () => {
    const out = into();
    const gh = fakeGitHub(
      { 42: { artifacts: ['gallery-screenshots'] } },
      {
        420: zip(
          Array.from({ length: MAX_ENTRIES_LOOKED_AT + 3 }, (_, i) => ({
            name: `c${String(i).padStart(4, '0')}.png`,
            data: PNG,
            badCrc: true,
          })),
        ),
      },
    );
    const text = collectScreenshots(SHA, out, gh.deps);
    expect(text).toContain(`stopped: ${String(MAX_ENTRIES_LOOKED_AT)} entries looked at`);
  });

  it(`lists at most ${String(MAX_DROPPED_SHOWN)} dropped entries, each name cut short, then how many more`, () => {
    const out = into();
    const gh = fakeGitHub(
      { 43: { artifacts: ['e2e-screenshots'] } },
      {
        430: zip(
          Array.from({ length: MAX_DROPPED_SHOWN + 70 }, (_, i) => ({
            name: `${'x'.repeat(1000)}${String(i)}.txt`,
            data: Buffer.from('x'),
          })),
        ),
      },
    );
    const text = collectScreenshots(SHA, out, gh.deps);
    const dropped = text
      .split('\n')
      .filter((line) => line.startsWith('    ') && !line.startsWith('    and '));
    expect(dropped).toHaveLength(MAX_DROPPED_SHOWN);
    expect(Math.max(...dropped.map((line) => line.length))).toBeLessThan(260);
    expect(text).toContain(
      `  dropped ${String(MAX_DROPPED_SHOWN + 70)}, the first ${String(MAX_DROPPED_SHOWN)}:`,
    );
    expect(text).toContain('    and 70 more');
  });

  it('writes nothing outside its folder, whatever the entry names say', () => {
    const parent = mkdtempSync(join(tmpdir(), 'lzp-shots-parent-'));
    const out = join(parent, 'bundle', 'screenshots');
    mkdirSync(out, { recursive: true });
    const gh = fakeGitHub(
      { 44: { artifacts: ['e2e-screenshots'] } },
      {
        440: zip([
          { name: '../../evil.png', data: PNG },
          { name: '/abs/x.png', data: PNG },
          { name: 'a\\..\\y.png', data: PNG },
        ]),
      },
    );
    const text = collectScreenshots(SHA, out, gh.deps);
    expect(readdirSync(parent)).toEqual(['bundle']);
    expect(readdirSync(join(parent, 'bundle'))).toEqual(['screenshots']);
    expect(existsSync(join(out, 'e2e-screenshots', 'evil.png'))).toBe(true);
    expect(readdirSync(join(out, 'e2e-screenshots')).sort()).toEqual(['evil.png', 'x.png']);
    expect(text).toContain('not a plainly named .png');
  });

  it('drops an entry whose stream does not inflate, and still lists the files kept around it', () => {
    const out = into();
    const good = zip([
      { name: 'a.png', data: PNG },
      { name: 'b.png', data: Buffer.from('will be broken') },
      { name: 'c.png', data: PNG },
    ]);
    // Corrupt b.png's deflate stream in place (its local record starts after a.png's).
    const bAt = good.indexOf(Buffer.from('b.png')) + 'b.png'.length;
    const broken = Buffer.from(good);
    broken.fill(0xff, bAt, bAt + 4);
    const gh = fakeGitHub({ 45: { artifacts: ['gallery-screenshots'] } }, { 450: broken });
    const text = collectScreenshots(SHA, out, gh.deps);
    expect(readdirSync(join(out, 'gallery-screenshots')).sort()).toEqual(['a.png', 'c.png']);
    expect(text).toContain('b.png: does not inflate');
    expect(text).toContain('2 in screenshots/gallery-screenshots/');
  });

  // Cerberus F1 on #213, round 4: listing stops once both artifacts are found.
  it('stops listing runs once both artifacts are found', () => {
    const out = into();
    const gh = fakeGitHub(
      {
        49: { artifacts: ['gallery-screenshots'] },
        50: { artifacts: ['e2e-screenshots'] },
        51: { artifacts: ['gallery-screenshots'] },
      },
      {
        500: zip([{ name: 'home.png', data: PNG }]),
        510: zip([{ name: 'card.png', data: PNG }]),
      },
    );
    collectScreenshots(SHA, out, gh.deps);
    expect(gh.calls.some((c) => c.includes('actions/runs/49/artifacts'))).toBe(false);
  });

  // Cerberus F1 on #213, round 4: one time limit for the whole step, not only for each gh call.
  it('stops the whole step at its time limit, and says so', () => {
    const out = into();
    let clock = 0;
    const gh = fakeGitHub(
      { 52: { artifacts: ['gallery-screenshots'] }, 53: { artifacts: ['e2e-screenshots'] } },
      { 520: zip([{ name: 'card.png', data: PNG }]), 530: zip([{ name: 'home.png', data: PNG }]) },
    );
    const fetchZip = (id: number) => {
      clock += 11 * 60 * 1000; // each download takes 11 minutes
      return gh.deps.fetchZip(id);
    };
    const text = collectScreenshots(SHA, out, {
      ...gh.deps,
      fetchZip,
      now: () => clock,
    });
    expect(gh.fetched).toEqual([520]); // the gallery's comes first
    expect(text).toContain(
      "e2e-screenshots: not fetched: the screenshot step's 10-minute limit ran out.",
    );
  });

  // Argus F1 on #220: once both artifacts are found, listing stops without looking at the clock, so a slow listing
  // ends as "not fetched" for each artifact (the step is past its limit), never as a failed listing.
  it('stops listing once both artifacts are found, even past the time limit', () => {
    const out = into();
    let clock = 0;
    const github = fakeGitHub(
      {
        49: { artifacts: ['gallery-screenshots'] },
        50: { artifacts: ['e2e-screenshots'] },
        51: { artifacts: ['gallery-screenshots'] },
      },
      {},
    );
    const gh = (args: string[]) => {
      const answer = github.deps.gh(args);
      if (args.join(' ').includes('actions/runs/50/artifacts')) clock += STEP_TIME_LIMIT_MS + 1;
      return answer;
    };
    const text = collectScreenshots(SHA, out, { ...github.deps, gh, now: () => clock });
    expect(text).not.toContain("Couldn't list");
    expect(text).toContain(
      "gallery-screenshots: not fetched: the screenshot step's 10-minute limit ran out.",
    );
    expect(text).toContain(
      "e2e-screenshots: not fetched: the screenshot step's 10-minute limit ran out.",
    );
    expect(github.calls.some((c) => c.includes('actions/runs/49/artifacts'))).toBe(false);
  });

  // Argus F2 on #220: the limit running out while listing.
  it('stops listing at the time limit, says so, and fetches nothing', () => {
    const out = into();
    let clock = 0;
    const github = fakeGitHub(
      { 54: { artifacts: ['gallery-screenshots'] }, 55: { artifacts: ['e2e-screenshots'] } },
      {
        540: zip([{ name: 'card.png', data: PNG }]),
        550: zip([{ name: 'home.png', data: PNG }]),
      },
    );
    const gh = (args: string[]) => {
      clock += 11 * 60 * 1000; // each listing call takes 11 minutes
      return github.deps.gh(args);
    };
    const text = collectScreenshots(SHA, out, { ...github.deps, gh, now: () => clock });
    expect(text).toBe(
      `Couldn't list CI's runs or artifacts on ${SHA} (the step's 10-minute limit ran out): no screenshots in this bundle.\n`,
    );
    expect(github.fetched).toEqual([]);
  });
});
