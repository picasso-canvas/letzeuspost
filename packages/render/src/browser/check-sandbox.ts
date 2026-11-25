// Proves, from inside the worker image, that the render browser starts with Chromium's OS sandbox on and that the
// worker is not root (§08 Security, #383). Run it in the image under the profile the worker runs under:
//   docker run --rm --security-opt seccomp=docker/seccomp/worker-chromium.json --cap-drop ALL <worker image> \
//     node packages/render/src/browser/check-sandbox.ts
// It prints one line and exits 0 only when every check holds. `picasso.ts deploy` runs it before any container is swapped.
import { readdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { LAUNCH_OPTIONS } from './flags.ts';

/** A text file under /proc, or undefined once the process is gone. */
function proc(pid: number, file: string): string | undefined {
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

async function check(): Promise<string> {
  if (process.getuid?.() === 0)
    throw new Error('the worker runs as root: it must run as a non-root user');
  const server = await chromium.launchServer(LAUNCH_OPTIONS);
  try {
    const argv = server.process().spawnargs;
    if (argv.includes('--no-sandbox')) throw new Error('Chromium was started with --no-sandbox');
    const browser = await chromium.connect(server.wsEndpoint());
    try {
      const page = await browser.newPage();
      await page.setContent('<p>সন্দেহজনক ফন্ট</p>');
      const renderers = renderersUnder(server.process().pid ?? -1);
      if (renderers.length === 0) throw new Error('no renderer process was found');
      for (const pid of renderers) {
        // 2 is SECCOMP_MODE_FILTER: the sandbox's syscall filter. A renderer started with --no-sandbox shows 0.
        if (!/^Seccomp:\s+2$/m.test(proc(pid, 'status') ?? '')) {
          throw new Error(`renderer ${String(pid)} is not under the sandbox's seccomp filter`);
        }
      }
      return `ok: uid ${String(process.getuid?.())}, ${String(renderers.length)} renderer(s) under the seccomp filter, no --no-sandbox`;
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
