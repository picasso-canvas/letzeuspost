// The screens a PR renders, for its reviewers (#212): CI's screenshot artifacts on the PR's head commit, copied into the
// review bundle so Iris can check new looks and approve first baselines (Q11). CI built them from the PR's code, so
// they are data like the rest of the bundle: only regular files that are PNGs by their first bytes, under a plain name,
// within a size and count limit, reach it. The download goes to a private temporary folder first, and only the
// checked files are copied in; every file dropped and every fetch that failed is said in screenshots.txt.
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
import { join, relative } from 'node:path';
import { REPO } from './merge-gate/collect.ts';
import { safeName } from './lib/safe-name.ts';

/** The artifacts with screenshots: the gallery's (`design` job) and the app's (`services` job's end-to-end step). */
export const SCREENSHOT_ARTIFACTS = ['gallery-screenshots', 'e2e-screenshots'] as const;
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const MAX_SCREENSHOTS = 400;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;

interface Run {
  id: number;
  name: string;
}

/** The newest run on this commit that holds each artifact (a re-run replaces an older one), or none. */
function findArtifacts(sha: string, gh: (args: string[]) => string): Map<string, Run> {
  const runs = JSON.parse(
    gh([
      'api',
      `repos/${REPO}/actions/runs?head_sha=${sha}&per_page=100`,
      '--jq',
      '[.workflow_runs[] | {id, name}]',
    ]),
  ) as Run[];
  const found = new Map<string, Run>();
  for (const run of [...runs].sort((a, b) => b.id - a.id)) {
    const names = JSON.parse(
      gh([
        'api',
        `repos/${REPO}/actions/runs/${String(run.id)}/artifacts`,
        '--jq',
        '[.artifacts[] | select(.expired | not) | .name]',
      ]),
    ) as string[];
    for (const name of names) {
      if ((SCREENSHOT_ARTIFACTS as readonly string[]).includes(name) && !found.has(name))
        found.set(name, run);
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

/**
 * Copies CI's screenshots for `sha` into `into/<artifact>/` and returns the text of screenshots.txt. A failed gh call
 * stops nothing: it is said in the text, so a reviewer who needs the screens blocks.
 */
export function collectScreenshots(
  sha: string,
  into: string,
  gh: (args: string[]) => string,
): string {
  const lines: string[] = [];
  let artifacts: Map<string, Run>;
  try {
    artifacts = findArtifacts(sha, gh);
  } catch {
    return `Couldn't list CI's runs or artifacts on ${sha}: no screenshots in this bundle.\n`;
  }
  let kept = 0;
  for (const name of SCREENSHOT_ARTIFACTS) {
    const run = artifacts.get(name);
    if (run === undefined) {
      lines.push(`${name}: none on ${sha.slice(0, 7)}.`);
      continue;
    }
    const scratch = mkdtempSync(join(tmpdir(), 'lzp-screenshots-'));
    try {
      try {
        gh(['run', 'download', String(run.id), '-R', REPO, '-n', name, '-D', scratch]);
      } catch {
        lines.push(
          `${name}: couldn't download it from run ${String(run.id)} (${safeName(run.name)}).`,
        );
        continue;
      }
      const out = join(into, name);
      mkdirSync(out, { recursive: true, mode: 0o700 });
      const files: string[] = [];
      const dropped: string[] = [];
      const seen = new Set<string>();
      for (const path of walk(scratch).sort()) {
        const shown = safeName(relative(scratch, path));
        const base = path.slice(path.lastIndexOf('/') + 1);
        const stat = lstatSync(path);
        let why: string | null = null;
        if (!stat.isFile()) why = 'not a regular file';
        else if (!PLAIN_NAME.test(base)) why = 'not a plainly named .png';
        else if (stat.size > MAX_SCREENSHOT_BYTES) why = 'over 5 MB';
        else if (seen.has(base)) why = 'a second file with the same name';
        else if (kept >= MAX_SCREENSHOTS) why = `past the limit of ${String(MAX_SCREENSHOTS)}`;
        else if (!readFileSync(path).subarray(0, 8).equals(PNG_SIGNATURE)) why = 'not a PNG';
        if (why !== null) {
          dropped.push(`${shown}: ${why}`);
          continue;
        }
        writeFileSync(join(out, base), readFileSync(path), { mode: 0o600 });
        seen.add(base);
        files.push(base);
        kept++;
      }
      lines.push(
        `${name}: run ${String(run.id)} (${safeName(run.name)}), ${String(files.length)} in screenshots/${name}/`,
        ...files.map((file) => `  ${file}`),
        ...(dropped.length > 0
          ? [`  dropped ${String(dropped.length)}:`, ...dropped.map((d) => `    ${d}`)]
          : []),
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  return `${lines.join('\n')}\n`;
}
