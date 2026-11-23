const RESIDENT = /^VmRSS:\s+(\d+)\s+kB$/m;

/**
 * The resident memory of the browser's processes, in bytes: the sum of `VmRSS` in each one's `/proc/<pid>/status`
 * (`read` returns that file's text). A process that has gone is skipped; undefined when none could be read (a system
 * with no `/proc`), so the memory limit is then never what restarts the browser.
 */
export async function residentBytes(
  pids: readonly number[],
  read: (pid: number) => Promise<string>,
): Promise<number | undefined> {
  const sizes = await Promise.all(
    pids.map(async (pid) => {
      try {
        const kb = RESIDENT.exec(await read(pid))?.[1];
        return kb === undefined ? undefined : Number(kb) * 1024;
      } catch {
        return undefined;
      }
    }),
  );
  const known = sizes.filter((size) => size !== undefined);
  return known.length === 0 ? undefined : known.reduce((sum, size) => sum + size, 0);
}
