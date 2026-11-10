// Stub: pg-boss comes in the next commit.
import type { Db } from '../db.ts';

export function createJobs(_options: { url: string; db: Db }) {
  return { send: (_name: string, _payload: unknown) => Promise.resolve('') };
}
