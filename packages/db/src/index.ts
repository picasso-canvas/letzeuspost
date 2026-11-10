// @lzp/db: the scoped helper, the migrations and the tables. The raw client never leaves this package; packages/auth
// has its own handle in `@lzp/db/auth` (Q5).
export { createDb, type Db, type Scoped, type Tx, type WorkspaceCtx } from './db.ts';
export { migrate } from './migrate.ts';
export * from './schema.ts';
