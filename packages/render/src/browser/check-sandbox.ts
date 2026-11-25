// Proves, from inside the worker image, that the render browser starts with Chromium's OS sandbox on and that the
// worker is not root (§08 Security, #383). Run it in the image under the profile the worker runs under:
//   docker run --rm --security-opt seccomp=docker/seccomp/worker-chromium.json --cap-drop ALL <worker image> \
//     node packages/render/src/browser/check-sandbox.ts
// It prints one line and exits 0 only when every check holds. `picasso.ts deploy` runs it before any container is swapped.
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { LAUNCH_OPTIONS, sandboxOffFlag } from './flags.ts';

/** A text file under /proc, or undefined once the process is gone. */
function proc(pid: number | 'self', file: string): string | undefined {
  try {
    return readFileSync(`/proc/${String(pid)}/${file}`, 'utf8');
  } catch {
    return undefined;
  }
}

/** The parent of a process, from /proc/<pid>/stat (its name, in brackets, may hold spaces and brackets). */
function parentOf(pid: number): number | undefined {
  const stat = proc(pid, 'stat');
  if (stat === undefined) return undefined;
  return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
}

/** Every process under `root` whose command line says it is a Chromium renderer. */
function renderersUnder(root: number): number[] {
  const pids = readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))
    .map(Number);
  return pids.filter((pid) => {
    if (proc(pid, 'cmdline')?.includes('--type=renderer') !== true) return false;
    for (
      let parent = parentOf(pid);
      parent !== undefined && parent > 1;
      parent = parentOf(parent)
    ) {
      if (parent === root) return true;
    }
    return false;
  });
}

/** How many seccomp filters a process has: a number, or undefined where the kernel doesn't say. */
function filtersOf(pid: number | 'self'): number | undefined {
  const count = /^Seccomp_filters:\s+(\d+)$/m.exec(proc(pid, 'status') ?? '')?.[1];
  return count === undefined ? undefined : Number(count);
}

/** The namespace a process is in (the link's text names it), or undefined once the process is gone. */
function namespaceOf(pid: number, kind: 'user' | 'pid'): string | undefined {
  try {
    return readlinkSync(`/proc/${String(pid)}/ns/${kind}`);
  } catch {
    return undefined;
  }
}

async function check(): Promise<string> {
  if (process.getuid?.() === 0)
    throw new Error('the worker runs as root: it must run as a non-root user');
  // Inside a container every process already has the container's own seccomp filter, so a renderer shows `Seccomp: 2`
  // with or without Chromium's: what the sandbox adds is more filters than the worker has.
  const own = filtersOf('self');
  if (own === undefined) throw new Error('the kernel does not report Seccomp_filters in /proc');
  const server = await chromium.launchServer(LAUNCH_OPTIONS);
  try {
    const browserPid = server.process().pid ?? -1;
    const off = sandboxOffFlag(server.process().spawnargs);
    if (off !== undefined) throw new Error(`Chromium was started with ${off}`);
    const browser = await chromium.connect(server.wsEndpoint());
    try {
      const page = await browser.newPage();
      await page.setContent('<p>সন্দেহজনক ফন্ট</p>');
      const renderers = renderersUnder(browserPid);
      if (renderers.length === 0) throw new Error('no renderer process was found');
      for (const pid of renderers) {
        const renderer = `renderer ${String(pid)}`;
        const flag = sandboxOffFlag((proc(pid, 'cmdline') ?? '').split('\0'));
        if (flag !== undefined) throw new Error(`${renderer} was started with ${flag}`);
        // The seccomp filter Chromium's sandbox adds, on top of the container's.
        if ((filtersOf(pid) ?? 0) <= own) {
          throw new Error(`${renderer} has no seccomp filter of the sandbox's own`);
        }
        // The user and PID namespaces the sandbox makes: the renderer must not share the browser's.
        for (const kind of ['user', 'pid'] as const) {
          const theirs = namespaceOf(pid, kind);
          if (theirs === undefined || theirs === namespaceOf(browserPid, kind)) {
            throw new Error(`${renderer} is not in a ${kind} namespace of its own`);
          }
        }
      }
      return `ok: uid ${String(process.getuid?.())}, ${String(renderers.length)} renderer(s) with the sandbox's own seccomp filter and their own user and PID namespaces, no sandbox-off switch`;
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}

try {
  console.log(`Chromium sandbox ${await check()}`);
} catch (error) {
  console.error(
    `Chromium sandbox FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
