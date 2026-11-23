export function residentBytes(
  _pids: readonly number[],
  _read: (pid: number) => Promise<string>,
): Promise<number | undefined> {
  return Promise.reject(new Error('not built yet'));
}
