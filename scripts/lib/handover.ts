import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, realpathSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

function lstatOrNull(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/**
 * Takes a builder's hand-over: moves the clone's `.lzp` folder to `taken` (in Athena's state, which no builder process
 * can reach, sandboxed or escaped) before anything in it is read. rename moves a link without following it, so a
 * `.lzp` swapped for a link to a secret folder is caught here and never read through. A folder taken earlier (a dry
 * run, a refusal) is reused.
 */
export function takeHandover(clone: string, taken: string): string {
  if (lstatOrNull(taken) === null) {
    if (lstatOrNull(join(clone, '.lzp')) === null)
      throw new Error(`no hand-over: ${clone} has no .lzp`);
    mkdirSync(dirname(taken), { recursive: true, mode: 0o700 });
    renameSync(join(clone, '.lzp'), taken);
  }
  const stat = lstatSync(taken);
  if (stat.isSymbolicLink()) {
    unlinkSync(taken); // the link only, never what it points at
    throw new Error(`the hand-over folder was a link; refused`);
  }
  if (!stat.isDirectory()) throw new Error(`the hand-over ${taken} isn't a folder`);
  return taken;
}

/** The processes `lsof -F pn` lists with a working folder or an open file in `dir`, except `self`. */
export function pidsUnder(lsof: string, dir: string, self: number): number[] {
  const pids = new Set<number>();
  let pid = 0;
  for (const line of lsof.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n')) {
      const name = line.slice(1);
      if ((name === dir || name.startsWith(`${dir}/`)) && pid > 0 && pid !== self) pids.add(pid);
    }
  }
  return [...pids];
}

/** The processes `ps -axE -o pid=,command=` lists with this dispatch's `LZP_DISPATCH` marker, except `self`. */
export function pidsWithMarker(ps: string, marker: string, self: number): number[] {
  if (!/^[0-9a-f]{32,}$/.test(marker)) throw new Error('bad dispatch marker');
  const tag = new RegExp(`(?:^|\\s)LZP_DISPATCH=${marker}(?=\\s|$)`);
  const pids: number[] = [];
  for (const line of ps.split('\n')) {
    const match = /^\s*(\d+)\s(.*)$/.exec(line);
    const pid = Number(match?.[1]);
    if (match && pid !== self && tag.test(match[2] ?? '')) pids.push(pid);
  }
  return pids;
}

/**
 * Every process of this user still at work for a builder: one with its working folder or an open file in the clone,
 * or one carrying the dispatch's marker in its environment. A child that left the builder's process group (`setsid`,
 * a detached spawn) survives the group kill but not this. One that also leaves the clone and drops the marker can
 * still escape: the sandbox confines its writes, and ship's rename of `.lzp` is the real control for the hand-over.
 */
export function builderProcesses(clone: string, marker?: string): number[] {
  const pids = new Set<number>();
  if (marker !== undefined) {
    const ps = execFileSync('ps', ['-axE', '-o', 'pid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    });
    for (const pid of pidsWithMarker(ps, marker, process.pid)) pids.add(pid);
  }
  let dir: string;
  try {
    dir = realpathSync(clone);
  } catch {
    return [...pids]; // no clone, nothing working in it
  }
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error('finding builder processes needs a POSIX system');
  // This process is always listed, so lsof exits 0; any other exit is a failure to look, and throws (fail closed).
  const out = execFileSync('lsof', ['-w', '-n', '-P', '-F', 'pn', '-u', String(uid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
  });
  for (const pid of pidsUnder(out, dir, process.pid)) pids.add(pid);
  return [...pids];
}

/** Kills every process still at work for the builder; returns the ones that were. */
export function killBuilderProcesses(clone: string, marker?: string): number[] {
  const pids = builderProcesses(clone, marker);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  return pids;
}
