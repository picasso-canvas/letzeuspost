// The app's one database handle (§13): the app role from DATABASE_URL, opened on first use and kept for the process.
// Pages, actions and routes reach workspace data only through `forWorkspace` on this handle.
import { loadEnv } from '@lzp/config';
import { createDb, type Db } from '@lzp/db';

// Kept on globalThis so `next dev`'s module reloads don't open a new pool on every edit.
const holder = globalThis as typeof globalThis & { lzpDb?: Db };

export function appDb(): Db {
  holder.lzpDb ??= createDb(loadEnv('web').DATABASE_URL);
  return holder.lzpDb;
}
