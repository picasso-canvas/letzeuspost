// Every table, one file per area in ./schema/. This file is what `db:generate` (drizzle-kit) reads, so a table belongs
// here or the next diff doesn't see it: snapshot.test.ts checks that every file in ./schema/ is exported (Argus F2 on
// #197).
export * from './schema/accounts.ts';
export * from './schema/email-message.ts';
