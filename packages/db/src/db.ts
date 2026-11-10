// The scoped helper (#71): written next.
import type pg from 'pg';

export interface Db {
  forWorkspace: (ctx: { workspaceId: string }) => {
    transaction: <T>(work: (tx: never) => Promise<T>) => Promise<T>;
  };
  ping: () => Promise<void>;
  close: () => Promise<void>;
}

export function dbOnPool(_pool: pg.Pool): Db {
  throw new Error('not written yet');
}

export function createDb(_url: string): Db {
  return { close: () => Promise.resolve() } as Db;
}
