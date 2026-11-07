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

/**
 * Every process of this user still working in a builder's clone: a child that left the builder's process group
 * (`setsid`, a detached spawn) survives the group kill but not this.
 */
export function builderProcesses(clone: string): number[] {
  let dir: string;
  try {
    dir = realpathSync(clone);
  } catch {
    return []; // no clone, nothing working in it
  }
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error('finding builder processes needs a POSIX system');
  // This process is always listed, so lsof exits 0; any other exit is a failure to look, and throws (fail closed).
  const out = execFileSync('lsof', ['-w', '-n', '-P', '-F', 'pn', '-u', String(uid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
  });
  return pidsUnder(out, dir, process.pid);
}

/** Kills every process still working in the clone; returns the ones that were. */
export function killBuilderProcesses(clone: string): number[] {
  const pids = builderProcesses(clone);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  return pids;
}
