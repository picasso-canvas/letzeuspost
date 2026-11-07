import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

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

/**
 * Deletes a builder's clone (or anything a builder could write to) safely: first renamed into `trashDir`, in Athena's
 * state, where no builder process can swap a folder for a link mid-walk; then deleted there. A link is removed, never
 * followed.
 */
export function trash(
  path: string,
  trashDir: string,
  remove: (path: string) => void = (p) => {
    rmSync(p, { recursive: true, force: true });
  },
): void {
  if (lstatOrNull(path) === null) return;
  mkdirSync(trashDir, { recursive: true, mode: 0o700 });
  const dest = join(
    trashDir,
    `${basename(path)}-${String(Date.now())}-${randomBytes(4).toString('hex')}`,
  );
  renameSync(path, dest);
  remove(dest);
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
 * True when one process's own `ps -E` output carries the marker in the environment it adds after the arguments
 * (`argsOnly`, from plain `ps`), never only in the arguments: Zeus's `grep LZP_DISPATCH=…` is not the builder's.
 */
export function markerInEnv(withEnv: string, argsOnly: string, marker: string): boolean {
  if (!/^[0-9a-f]{32,}$/.test(marker)) return false;
  const args = argsOnly.trimEnd();
  const all = withEnv.trimEnd();
  if (args === '' || !all.startsWith(args)) return false;
  return new RegExp(`(?:^|\\s)LZP_DISPATCH=${marker}(?=\\s|$)`).test(all.slice(args.length));
}

function psOf(pid: number, withEnv: boolean): string {
  try {
    return execFileSync('ps', [withEnv ? '-wwE' : '-ww', '-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return ''; // gone
  }
}

/**
 * The processes carrying this dispatch's `LZP_DISPATCH` marker in their environment, wherever they went. Each pid
 * the full listing names is checked again on its own, so a line can only ever name its own process. (macOS's ps
 * prints a newline inside a value as `\012`, checked 2026-11-07, so one line is one process anyway.)
 */
export function markedProcesses(marker: string): number[] {
  const ps = execFileSync('ps', ['-axE', '-o', 'pid=,command='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
  });
  return pidsWithMarker(ps, marker, process.pid).filter((pid) =>
    markerInEnv(psOf(pid, true), psOf(pid, false), marker),
  );
}

/**
 * Every process of this user that may still be at work for a builder: one with its working folder or an open file in
 * the clone, or one carrying the dispatch's marker in its environment. Ship and dispatch refuse while any are listed.
 * macOS shows the environment of node and other non-system programs only (not of `sh`, `sleep` or `perl`), so a
 * process that leaves the clone through a system program can still escape: the sandbox confines its writes, and ship's
 * rename of `.lzp` is the real control for the hand-over. A separate macOS user for builders would close this.
 */
export function builderProcesses(clone: string, marker?: string): number[] {
  const pids = new Set<number>(marker === undefined ? [] : markedProcesses(marker));
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

/**
 * Kills the processes carrying this dispatch's marker (the builder's own, wherever they went) and returns them. A
 * process found only by lsof is never killed blind (it may be Zeus's editor or Athena's own tool); it is listed, and
 * dispatch and ship refuse until someone has looked.
 */
export function killMarkedProcesses(marker: string): number[] {
  const pids = markedProcesses(marker);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  return pids;
}
