// @lzp/db: the scoped helper, the migrations and the workspace tables. The raw client never leaves this package;
// packages/auth has its own handle in `@lzp/db/auth` (Q5). Better Auth's tables (user, session, account, verification)
// are exported only from there (#176): workspace code has no use for them, and its role can't reach them anyway.
export { createDb, type Db, type Scoped, type Tx, type WorkspaceCtx } from './db.ts';
export { migrate } from './migrate.ts';
export { invitation, member, roles, workspace } from './schema.ts';
