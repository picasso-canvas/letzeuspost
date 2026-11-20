// One dispatch at a time past the one-feature rule (#148, Cerberus [nit] F3 on #155): two dispatches started at once
// for different features would each read the records before either wrote its own, and both pass. The lock is an
// exclusive create of `<folder>/.lock` holding the dispatcher's pid; it isn't a dispatch record (`<issue>.json`), so
// the feature rule never reads it as one.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Whether a process with this pid exists: `kill -0` sends nothing. EPERM still means it exists. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === 'EPERM';
  }
}

export type DispatchLock = { release: () => void } | { refusal: string };

/**
 * Why a takeover can't start: another dispatch holds the guard. The guard stays fail-closed (a dead taker's guard is
 * never removed by a dispatch), so the message says whose it is and whether that process is still running, and a dead
 * one can be removed by hand (Cerberus F1, Argus F1 on #279).
 */
function guardRefusal(path: string, guard: string, alive: (pid: number) => boolean): string {
  let owner = Number.NaN;
  try {
    owner = Number(readFileSync(guard, 'utf8').trim());
  } catch {
    // gone already, or being written
  }
  if (!Number.isInteger(owner) || owner <= 0)
    return `another dispatch is taking over a stale ${path} (${guard} has no readable pid): wait for it, then dispatch again`;
  if (alive(owner))
    return `another dispatch is taking over a stale ${path} (pid ${String(owner)} holds ${guard} and is still running): wait for it, then dispatch again`;
  return `another dispatch was taking over a stale ${path}, but pid ${String(owner)} is gone: look, then remove ${guard} if no dispatch is starting`;
}

/**
 * Takes the lock, or says who holds it. A lock whose process is gone is taken over; one that can't be read is
 * refused, not taken, since it may belong to a dispatch that is running.
 */
export function takeDispatchLock(
  folder: string,
  alive: (pid: number) => boolean = pidAlive,
): DispatchLock {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, '.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, `${String(process.pid)}\n`, { flag: 'wx', mode: 0o600 });
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          // Only a lock that is still ours: one taken over after this process was thought dead stays.
          try {
            if (readFileSync(path, 'utf8').trim() === String(process.pid))
              rmSync(path, { force: true });
          } catch {
            // already gone
          }
        },
      };
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
    }
    let holder: number;
    try {
      holder = Number(readFileSync(path, 'utf8').trim());
    } catch (error) {
      if ((error as { code?: unknown }).code === 'ENOENT') continue; // let go between our two looks: try again
      throw error;
    }
    if (!Number.isInteger(holder) || holder <= 0)
      return {
        refusal: `${path} can't be read as a pid: look, then remove it if no dispatch is starting`,
      };
    if (alive(holder))
      return {
        refusal: `another dispatch is starting (pid ${String(holder)} holds ${path}): wait for it, then dispatch again`,
      };
    // Its process is gone. Two dispatches can both see that, so only one at a time takes the lock over, and it looks
    // again before removing: a lock another dispatch took meanwhile is theirs (Argus F1, Cerberus F1 on #279).
    const guard = `${path}.takeover`;
    try {
      writeFileSync(guard, `${String(process.pid)}\n`, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
      return { refusal: guardRefusal(path, guard, alive) };
    }
    try {
      if (readFileSync(path, 'utf8').trim() === String(holder)) rmSync(path, { force: true });
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'ENOENT') throw error;
    } finally {
      rmSync(guard, { force: true });
    }
  }
  return { refusal: `couldn't take ${path}: another dispatch took it first` };
}
