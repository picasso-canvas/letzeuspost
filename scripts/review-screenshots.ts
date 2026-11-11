// The screens a PR renders, for its reviewers (#212): CI's screenshot artifacts on the PR's head commit, copied into the
// review bundle so Iris can check new looks and approve first baselines (Q11). CI built them from the PR's code, so
// they are data like the rest of the bundle, and the PR decides their size: an artifact is taken only from the
// workflow that renders it, on a pull_request run, and only when GitHub says it is under the size limit; it is
// downloaded into a private temporary folder, and only regular files that are PNGs by their first bytes, under a plain
// name, within a size and count limit, are copied in. Every file dropped and every fetch refused or failed is said in
// screenshots.txt.
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;

interface Found {
  run: { id: number; name: string };
  size: number;
}

/** The newest pull_request run of each artifact's own workflow on this commit that still holds it, or none. */
function findArtifacts(sha: string, gh: (args: string[]) => string): Map<ArtifactName, Found> {
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
        '[.artifacts[] | {name, expired, size_in_bytes}]',
      ]),
    ) as { name: string; expired: boolean; size_in_bytes: number }[];
    for (const name of wanted) {
      const artifact = artifacts.find((a) => a.name === name && !a.expired);
      if (artifact !== undefined)
        found.set(name, { run: { id: run.id, name: run.name }, size: artifact.size_in_bytes });
    }
  }
  return found;
}

/** Every entry under `dir`, never following a link. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return lstatSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** A folder's name as a plain prefix: the app-light and app-dark projects write the same file names (Argus F1). */
function folderPrefix(folder: string): string {
  const plain = folder
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+|-+$/g, '')
    .slice(0, 80);
  return plain === '' ? 'folder' : plain;
}

const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

/** The files one artifact's download holds, checked and copied into `out`; returns its lines for screenshots.txt. */
function copyChecked(
  scratch: string,
  out: string,
  room: number,
): { lines: string[]; kept: number } {
  const files: string[] = [];
  const dropped: string[] = [];
  const candidates: { path: string; base: string }[] = [];
  for (const path of walk(scratch).sort()) {
    const shown = safeName(relative(scratch, path));
    const base = basename(path);
    const stat = lstatSync(path);
    let why: string | null = null;
    if (!stat.isFile()) why = 'not a regular file';
    else if (!PLAIN_NAME.test(base)) why = 'not a plainly named .png';
    else if (stat.size > MAX_SCREENSHOT_BYTES) why = 'over 5 MB';
    if (why === null) candidates.push({ path, base });
    else dropped.push(`${shown}: ${why}`);
  }
  // A name that appears more than once (letter case aside: the disk ignores it) takes its folder's name in front.
  const count = new Map<string, number>();
  for (const { base } of candidates)
    count.set(base.toLowerCase(), (count.get(base.toLowerCase()) ?? 0) + 1);
  const taken = new Set<string>();
  for (const { path, base } of candidates) {
    const shown = safeName(relative(scratch, path));
    const name =
      (count.get(base.toLowerCase()) ?? 0) > 1
        ? `${folderPrefix(relative(scratch, dirname(path)))}__${base}`
        : base;
    let why: string | null = null;
    let bytes: Buffer | null = null;
    if (taken.has(name.toLowerCase())) why = 'a second file with the same name';
    else if (files.length >= room) why = `past the limit of ${String(MAX_SCREENSHOTS)}`;
    else {
      bytes = readFileSync(path);
      if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) why = 'not a PNG';
    }
    if (why !== null || bytes === null) {
      dropped.push(`${shown}: ${why ?? 'unreadable'}`);
      continue;
    }
    writeFileSync(join(out, name), bytes, { mode: 0o600 });
    taken.add(name.toLowerCase());
    files.push(name);
  }
  return {
    lines: [
      ...files.map((file) => `  ${file}`),
      ...(dropped.length > 0
        ? [`  dropped ${String(dropped.length)}:`, ...dropped.map((d) => `    ${d}`)]
        : []),
    ],
    kept: files.length,
  };
}

/**
 * Copies CI's screenshots for `sha` into `into/<artifact>/` and returns the text of screenshots.txt. A failed gh call
 * stops nothing: it is said in the text, so a reviewer who needs the screens blocks.
 */
export function collectScreenshots(
  sha: string,
  into: string,
  gh: (args: string[]) => string,
): string {
  let artifacts: Map<ArtifactName, Found>;
  try {
    artifacts = findArtifacts(sha, gh);
  } catch {
    return `Couldn't list CI's runs or artifacts on ${sha}: no screenshots in this bundle.\n`;
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
    const scratch = mkdtempSync(join(tmpdir(), 'lzp-screenshots-'));
    try {
      try {
        gh(['run', 'download', String(found.run.id), '-R', REPO, '-n', name, '-D', scratch]);
      } catch {
        lines.push(`${name}: couldn't download it from ${from}.`);
        continue;
      }
      const out = join(into, name);
      mkdirSync(out, { recursive: true, mode: 0o700 });
      const copied = copyChecked(scratch, out, MAX_SCREENSHOTS - kept);
      kept += copied.kept;
      lines.push(
        `${name}: ${from}, ${String(copied.kept)} in screenshots/${name}/`,
        ...copied.lines,
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  return `${lines.join('\n')}\n`;
}
