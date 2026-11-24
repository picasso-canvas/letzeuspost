import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { Browser } from 'playwright-core';
import { residentBytes } from '../src/browser/memory.ts';

// The browser's memory, as the renderer itself reads it (`src/browser/memory.ts`: the resident size of every browser
// process, from `/proc` on Linux), plus a fallback for the Picasso Mac, which has no `/proc`: `ps -o rss=`.

const run = promisify(execFile);

/** `ps -o rss=` output (kilobytes) as the `/proc/<pid>/status` text that `residentBytes` reads. */
export function statusFromPs(output: string): string {
  const kb = /^\s*(\d+)\s*$/.exec(output)?.[1];
  if (kb === undefined) throw new Error('ps gave no size');
  return `VmRSS:\t${kb} kB`;
}

async function readStatus(pid: number): Promise<string> {
  try {
    return await readFile(`/proc/${String(pid)}/status`, 'utf8');
  } catch {
    const { stdout } = await run('ps', ['-o', 'rss=', '-p', String(pid)]);
    return statusFromPs(stdout);
  }
}

/** The resident memory of all of the browser's processes in bytes; undefined when none could be read. */
export async function browserBytes(browser: Browser): Promise<number | undefined> {
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    return await residentBytes(
      processInfo.map((info) => info.id),
      readStatus,
    );
  } finally {
    await session.detach().catch(() => undefined);
  }
}
