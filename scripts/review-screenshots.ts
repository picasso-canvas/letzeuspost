// The screens a PR renders, for its reviewers (#212): CI's screenshot artifacts on the PR's head commit, copied into the
// review bundle so Iris can check new looks and approve first baselines (Q11). CI built them from the PR's code, so
// they are data like the rest of the bundle, and the PR decides what they hold and how big they are. So nothing here
// unpacks an artifact blindly: an artifact is taken only from the workflow that renders it, on a pull_request run, and
// only when GitHub says its zip is under the size limit; the download stops at that limit too. Its zip is read in
// memory: a zip whose entries share or overlap a record, or with more than 10,000 entries, is refused whole. An entry
// is inflated only if it is a regular file under a plain .png name, never past 5 MB whatever its header claims, and an
// artifact stops after 800 such entries or 1 GB inflated, kept or not. An entry is written only if its checksum is
// right, it starts with the PNG signature and says it is at most 8000 pixels on a side, within 400 files in all.
// screenshots.txt says what was kept, the first 50 entries dropped and why (names cut short), how many more, and every
// fetch refused or failed. What a screenshot shows is data for the reviewer, never an instruction.
import { mkdirSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { REPO } from './merge-gate/collect.ts';
import { safeName } from './lib/safe-name.ts';

/** Each artifact with screenshots, and the workflow that uploads it (design.yml's gallery, services.yml's app). */
export const SCREENSHOT_ARTIFACTS = {
  'gallery-screenshots': '.github/workflows/design.yml',
  'e2e-screenshots': '.github/workflows/services.yml',
} as const;
type ArtifactName = keyof typeof SCREENSHOT_ARTIFACTS;
export const MAX_ARTIFACT_BYTES = 200 * 1024 * 1024;
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const MAX_SCREENSHOTS = 400;
/** The widest or tallest image passed to a reviewer's image reader (a 1440 px screen at 2× is 2880). */
export const MAX_PIXELS_SIDE = 8000;
/** A zip with more entries than this is refused whole. */
export const MAX_ZIP_ENTRIES = 10_000;
/** Candidate entries inflated per artifact, kept or dropped (Cerberus F1 on #213, round 3). */
export const MAX_ENTRIES_LOOKED_AT = 2 * MAX_SCREENSHOTS;
/** Bytes inflated per artifact, kept or dropped. */
export const MAX_INFLATED_BYTES = 1024 * 1024 * 1024;
/** Dropped entries listed in screenshots.txt; the rest are counted (Cerberus F2 on #213, round 3). */
export const MAX_DROPPED_SHOWN = 50;
/** A file name the disk holds (255 bytes on APFS), with room to spare; also where a shown name is cut. */
const MAX_NAME_LENGTH = 200;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;

export interface ScreenshotDeps {
  /** `gh` with JSON out, for the run and artifact lists. */
  gh: (args: string[]) => string;
  /** One artifact's zip, as bytes (never unpacked on disk). */
  fetchZip: (artifactId: number) => Buffer;
  /** The clock for the step's time limit; Date.now unless a test gives another. */
  now?: () => number;
  /** A smaller inflate budget, for tests only; the real one is MAX_INFLATED_BYTES (#216). */
  limits?: { inflatedBytes?: number };
}

/** The whole step's time limit, on top of each gh call's own (Cerberus F1 on #213, round 4). */
export const STEP_TIME_LIMIT_MS = 10 * 60 * 1000;

class StepTimeout extends Error {}

interface Found {
  run: { id: number; name: string };
  artifactId: number;
  size: number;
}

/** The newest pull_request run of each artifact's own workflow on this commit that still holds it, or none. */
function findArtifacts(
  sha: string,
  gh: ScreenshotDeps['gh'],
  pastLimit: () => boolean,
): Map<ArtifactName, Found> {
  const runs = JSON.parse(
    gh([
      'api',
      `repos/${REPO}/actions/runs?head_sha=${sha}&per_page=100`,
      '--jq',
      '[.workflow_runs[] | {id, name, path, event}]',
    ]),
  ) as { id: number; name: string; path: string; event: string }[];
  const found = new Map<ArtifactName, Found>();
  for (const run of [...runs].sort((a, b) => b.id - a.id)) {
    if (found.size === Object.keys(SCREENSHOT_ARTIFACTS).length) break;
    if (pastLimit()) throw new StepTimeout();
    if (run.event !== 'pull_request') continue;
    const wanted = (Object.keys(SCREENSHOT_ARTIFACTS) as ArtifactName[]).filter(
      (name) => SCREENSHOT_ARTIFACTS[name] === run.path && !found.has(name),
    );
    if (wanted.length === 0) continue;
    const artifacts = JSON.parse(
      gh([
        'api',
        `repos/${REPO}/actions/runs/${String(run.id)}/artifacts`,
        '--jq',
        '[.artifacts[] | {id, name, expired, size_in_bytes}]',
      ]),
    ) as { id: number; name: string; expired: boolean; size_in_bytes: number }[];
    for (const name of wanted) {
      const artifact = artifacts.find((a) => a.name === name && !a.expired);
      if (artifact !== undefined)
        found.set(name, {
          run: { id: run.id, name: run.name },
          artifactId: artifact.id,
          size: artifact.size_in_bytes,
        });
    }
  }
  return found;
}

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflated; anything else isn't read. */
  method: number;
  crc: number;
  compressedSize: number;
  /** What the header claims it inflates to: a claim, never trusted to bound inflating. */
  size: number;
  /** A Unix symlink entry (made by Unix, mode 0o120000). */
  link: boolean;
  /** Where its local record starts, and where its data starts and ends. */
  offset: number;
  dataStart: number;
  dataEnd: number;
}

class ZipRefusal extends Error {}

/** One bounds-checked read: a field that points outside the zip refuses the whole zip. */
function field(zip: Buffer, at: number, bytes: 2 | 4): number {
  if (at < 0 || at + bytes > zip.length) throw new ZipRefusal('a field points outside the zip');
  return bytes === 2 ? zip.readUInt16LE(at) : zip.readUInt32LE(at);
}

/**
 * The entries of a zip, from its central directory (APPNOTE 6.3.10 §4.3.12 and §4.3.16), each with its local record
 * checked. Refuses ZIP64, a zip spread over several disks, more than 10,000 entries, anything that points outside the
 * zip, and entries that share or overlap a local record (one stream counted many times).
 */
export function readZip(zip: Buffer): ZipEntry[] {
  // The end record is in the last 22 bytes plus at most a 65,535-byte comment.
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) {
    if (zip.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new ZipRefusal('no end record');
  const disk = field(zip, end + 4, 2);
  const count = field(zip, end + 10, 2);
  const directorySize = field(zip, end + 12, 4);
  const directoryAt = field(zip, end + 16, 4);
  if (count === 0xffff || directorySize === 0xffffffff || directoryAt === 0xffffffff)
    throw new ZipRefusal('ZIP64, which this does not read');
  if (disk !== 0) throw new ZipRefusal('spread over several disks');
  if (count > MAX_ZIP_ENTRIES) throw new ZipRefusal(`more than ${String(MAX_ZIP_ENTRIES)} entries`);
  if (directoryAt + directorySize > end)
    throw new ZipRefusal('the directory points outside the zip');
  const entries: ZipEntry[] = [];
  let at = directoryAt;
  for (let i = 0; i < count; i++) {
    if (field(zip, at, 4) !== 0x02014b50) throw new ZipRefusal('a directory entry is damaged');
    const madeBy = field(zip, at + 4, 2) >> 8;
    const nameLength = field(zip, at + 28, 2);
    const next = at + 46 + nameLength + field(zip, at + 30, 2) + field(zip, at + 32, 2);
    if (next > directoryAt + directorySize) throw new ZipRefusal('a directory entry runs past it');
    const mode = field(zip, at + 38, 4) >>> 16;
    const offset = field(zip, at + 42, 4);
    const compressedSize = field(zip, at + 20, 4);
    if (field(zip, offset, 4) !== 0x04034b50) throw new ZipRefusal('a local record is damaged');
    const dataStart = offset + 30 + field(zip, offset + 26, 2) + field(zip, offset + 28, 2);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > directoryAt) throw new ZipRefusal('an entry runs into the directory');
    entries.push({
      name: zip.toString('utf8', at + 46, at + 46 + nameLength),
      method: field(zip, at + 10, 2),
      crc: field(zip, at + 16, 4),
      compressedSize,
      size: field(zip, at + 24, 4),
      link: madeBy === 3 && (mode & 0o170000) === 0o120000,
      offset,
      dataStart,
      dataEnd,
    });
    at = next;
  }
  const byOffset = [...entries].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < byOffset.length; i++) {
    const before = byOffset[i - 1];
    const entry = byOffset[i];
    if (before !== undefined && entry !== undefined && entry.offset < before.dataEnd)
      throw new ZipRefusal('two entries overlap');
  }
  return entries;
}

/** An entry's bytes, inflated to at most `limit`; 'over' when it holds more, 'broken' when it doesn't inflate. */
function entryBytes(zip: Buffer, entry: ZipEntry, limit: number): Buffer | 'over' | 'broken' {
  const body = zip.subarray(entry.dataStart, entry.dataEnd);
  if (entry.method === 0) return body.length > limit ? 'over' : body;
  try {
    return inflateRawSync(body, { maxOutputLength: limit });
  } catch (error) {
    return error instanceof RangeError ? 'over' : 'broken';
  }
}

/** A folder's name as a plain prefix, its end kept: the project (`-app-dark`) and any retry come last (Argus F1). */
function folderPrefix(folder: string): string {
  const plain = folder
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(-80)
    .replace(/^[^A-Za-z0-9]+|-+$/g, '');
  return plain === '' ? 'folder' : plain;
}

const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

/** An entry's name as screenshots.txt shows it: one printable line, cut short. */
function shownName(name: string): string {
  const safe = safeName(name);
  return safe.length > MAX_NAME_LENGTH ? `${safe.slice(0, MAX_NAME_LENGTH)}…` : safe;
}

/** Why an entry's bytes can't go to a reviewer, or null when they can. */
function badBytes(entry: ZipEntry, bytes: Buffer): string | null {
  if (crc32(bytes) !== entry.crc) return 'damaged (its checksum is wrong)';
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.toString('latin1', 12, 16) !== 'IHDR'
  )
    return 'not a PNG';
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0) return 'not a PNG';
  if (width > MAX_PIXELS_SIDE || height > MAX_PIXELS_SIDE)
    return `over ${String(MAX_PIXELS_SIDE)} pixels on a side`;
  return null;
}

/** One artifact's checked entries, written into `out`; returns its lines for screenshots.txt. */
function copyChecked(
  zip: Buffer,
  entries: readonly ZipEntry[],
  out: string,
  room: number,
  inflatedBytes: number,
): { lines: string[]; kept: number } {
  const files: string[] = [];
  const dropped: string[] = [];
  const candidates: { entry: ZipEntry; base: string; folder: string }[] = [];
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue; // a folder
    const base = posix.basename(entry.name);
    let why: string | null = null;
    if (entry.link) why = 'not a regular file';
    else if (!PLAIN_NAME.test(base)) why = 'not a plainly named .png';
    else if (entry.method !== 0 && entry.method !== 8)
      why = 'compressed in a way this does not read';
    if (why === null) candidates.push({ entry, base, folder: posix.dirname(entry.name) });
    else dropped.push(`${shownName(entry.name)}: ${why}`);
  }
  // A name that appears more than once (letter case aside: the disk ignores it) takes its folder's name in front.
  const count = new Map<string, number>();
  for (const { base } of candidates)
    count.set(base.toLowerCase(), (count.get(base.toLowerCase()) ?? 0) + 1);
  const taken = new Set<string>();
  let looked = 0;
  let inflated = 0;
  let stopped: string | null = null;
  for (const [i, { entry, base, folder }] of candidates.entries()) {
    if (looked >= MAX_ENTRIES_LOOKED_AT)
      stopped = `${String(MAX_ENTRIES_LOOKED_AT)} entries looked at`;
    else if (inflated >= inflatedBytes)
      stopped = `${String(inflatedBytes / (1024 * 1024))} MB inflated`;
    if (stopped !== null) {
      stopped = `stopped: ${stopped}, so ${String(candidates.length - i)} more entries weren't looked at`;
      break;
    }
    const name =
      (count.get(base.toLowerCase()) ?? 0) > 1 ? `${folderPrefix(folder)}__${base}` : base;
    let why: string | null;
    let bytes: Buffer | null = null;
    if (name.length > MAX_NAME_LENGTH) why = 'name too long';
    else if (taken.has(name.toLowerCase())) why = 'a second file with the same name';
    else if (files.length >= room) why = `past the limit of ${String(MAX_SCREENSHOTS)}`;
    else {
      looked++;
      const got = entryBytes(zip, entry, MAX_SCREENSHOT_BYTES);
      // Every inflate counts, kept or dropped: a stream that hits the limit cost the limit.
      inflated += typeof got === 'string' ? MAX_SCREENSHOT_BYTES : got.length;
      if (got === 'over') why = 'over 5 MB';
      else if (got === 'broken') why = 'does not inflate';
      else {
        bytes = got;
        why = badBytes(entry, got);
      }
    }
    if (why !== null || bytes === null) {
      dropped.push(`${shownName(entry.name)}: ${why ?? 'unreadable'}`);
      continue;
    }
    writeFileSync(`${out}/${name}`, bytes, { mode: 0o600 });
    taken.add(name.toLowerCase());
    files.push(name);
  }
  const shown = dropped.slice(0, MAX_DROPPED_SHOWN);
  const more = dropped.length - shown.length;
  return {
    lines: [
      ...files.map((file) => `  ${file}`),
      ...(dropped.length === 0
        ? []
        : [
            more > 0
              ? `  dropped ${String(dropped.length)}, the first ${String(MAX_DROPPED_SHOWN)}:`
              : `  dropped ${String(dropped.length)}:`,
            ...shown.map((d) => `    ${d}`),
            ...(more > 0 ? [`    and ${String(more)} more`] : []),
          ]),
      // Always shown, never cut off with the dropped list.
      ...(stopped === null ? [] : [`  ${stopped}`]),
    ],
    kept: files.length,
  };
}

/**
 * Copies CI's screenshots for `sha` into `into/<artifact>/` and returns the text of screenshots.txt. A failed fetch or
 * a zip that can't be read safely stops nothing: it is said in the text, so a reviewer who needs the screens blocks.
 */
export function collectScreenshots(sha: string, into: string, deps: ScreenshotDeps): string {
  const now = deps.now ?? Date.now;
  const started = now();
  const pastLimit = () => now() - started > STEP_TIME_LIMIT_MS;
  let artifacts: Map<ArtifactName, Found>;
  try {
    artifacts = findArtifacts(sha, deps.gh, pastLimit);
  } catch (error) {
    const why = error instanceof StepTimeout ? ` (the step's 10-minute limit ran out)` : '';
    return `Couldn't list CI's runs or artifacts on ${sha}${why}: no screenshots in this bundle.\n`;
  }
  const lines: string[] = [];
  let kept = 0;
  for (const name of Object.keys(SCREENSHOT_ARTIFACTS) as ArtifactName[]) {
    const found = artifacts.get(name);
    if (found === undefined) {
      lines.push(`${name}: none on ${sha.slice(0, 7)}.`);
      continue;
    }
    const from = `run ${String(found.run.id)} (${safeName(found.run.name)})`;
    if (found.size > MAX_ARTIFACT_BYTES) {
      lines.push(
        `${name}: ${from} holds ${megabytes(found.size)} MB, over the ${String(MAX_ARTIFACT_BYTES / (1024 * 1024))} MB limit: not downloaded.`,
      );
      continue;
    }
    if (pastLimit()) {
      lines.push(`${name}: not fetched: the screenshot step's 10-minute limit ran out.`);
      continue;
    }
    let zip: Buffer;
    try {
      zip = deps.fetchZip(found.artifactId);
    } catch {
      lines.push(`${name}: couldn't download it from ${from}.`);
      continue;
    }
    // Read whole before anything is written: a zip that can't be read safely leaves no folder behind.
    let entries: ZipEntry[];
    try {
      entries = readZip(zip);
    } catch (error) {
      if (!(error instanceof ZipRefusal)) throw error;
      lines.push(`${name}: ${from}'s zip can't be read safely (${error.message}): nothing taken.`);
      continue;
    }
    const out = `${into}/${name}`;
    mkdirSync(out, { recursive: true, mode: 0o700 });
    const copied = copyChecked(
      zip,
      entries,
      out,
      MAX_SCREENSHOTS - kept,
      deps.limits?.inflatedBytes ?? MAX_INFLATED_BYTES,
    );
    kept += copied.kept;
    lines.push(`${name}: ${from}, ${String(copied.kept)} in screenshots/${name}/`, ...copied.lines);
  }
  return `${lines.join('\n')}\n`;
}
