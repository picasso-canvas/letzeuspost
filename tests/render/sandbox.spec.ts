import { readdirSync, readFileSync } from 'node:fs';
import { chromium, expect, test, type BrowserServer } from '@playwright/test';
import { LAUNCH_OPTIONS } from '../../packages/render/src/browser/index.ts';

// Chromium's OS sandbox in the render browser (§08 Chrome in Docker, Security; #350): a renderer exploit through a
// hostile font or image must not run with the worker's rights. These run in CI's services job, the `render` project,
// on Linux, where the job lets unprivileged user namespaces be made (#380) and where the worker runs (§13).

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
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return Number(fields[1]);
}

/** Every process under `root` whose command line says it is a Chromium renderer. */
function renderersUnder(root: number): number[] {
  const pids = readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))
    .map(Number);
  return pids.filter((pid) => {
    if (!proc(pid, 'cmdline')?.includes('--type=renderer')) return false;
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

let server: BrowserServer;

test.beforeEach(async () => {
  server = await chromium.launchServer(LAUNCH_OPTIONS);
});

test.afterEach(async () => {
  await server.close();
});

test('the render browser starts with no --no-sandbox on its command line', () => {
  const argv = server.process().spawnargs;
  expect(argv.length).toBeGreaterThan(1);
  expect(argv).not.toContain('--no-sandbox');
});

test('every page of the render browser runs in a renderer under the sandbox’s seccomp filter', async () => {
  // /proc is Linux's; the worker and CI's services job are Linux, so this never skips where it proves anything.
  test.skip(process.platform !== 'linux', 'reads /proc, which only Linux has');

  const browserPid = server.process().pid;
  expect(browserPid).toBeDefined();
  const browser = await chromium.connect(server.wsEndpoint());
  try {
    const page = await browser.newPage();
    await page.setContent('<p>সন্দেহজনক ফন্ট</p>');
    await expect(page.locator('p')).toHaveText('সন্দেহজনক ফন্ট');

    const renderers = renderersUnder(browserPid ?? -1);
    expect(renderers.length).toBeGreaterThan(0);
    for (const pid of renderers) {
      // 2 is SECCOMP_MODE_FILTER: the sandbox's syscall filter. A renderer started with --no-sandbox shows 0.
      expect(proc(pid, 'status'), `renderer ${String(pid)}`).toMatch(/^Seccomp:\s+2$/m);
    }
  } finally {
    await browser.close();
  }
});
