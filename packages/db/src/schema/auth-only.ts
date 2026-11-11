// The tables sign-in adds (#77). Like Better Auth's own (./accounts.ts), they hold no workspace data and only lzp_auth,
// the auth handle's role, reaches them: they are exported from @lzp/db/auth, never from @lzp/db.
//
// - `account_email`: the account emails' outbox (Athena's decision 3, 2026-11-11). A sign-in link goes here, never into
//   a workspace's rows: the request writes one row and queues an `account-email` job with its id; the worker sends it
//   through packages/auth. Its states are email_message's (./email-message.ts). The link is cleared from `data` once
//   the row is sent or failed, so a row keeps it only while it may still go out (10 minutes at most: A5).
// - `rate_limit_hit`: §13's rate limits in a Postgres table (one server at launch). One row per allowed request in a
//   bucket; a request is refused while its bucket holds the limit's count of rows younger than the window.
//
// Written by hand in ../../migrations/0005_sign_in.sql (§13 A4), like the other tables. Change both together.
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './accounts.ts';
import { emailStatuses } from './email-message.ts';

const time = (name: string) => timestamp(name, { withTimezone: true });
const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);

export const accountEmail = pgTable(
  'account_email',
  {
    id: id(),
    /** Whose account it is: a person's pending emails go with them. */
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** A template name from @lzp/email. */
    template: text('template').notNull(),
    toAddress: text('to_address').notNull(),
    /** The template's data (the sign-in link), cleared once the row is sent or failed. */
    data: jsonb('data').notNull().default({}),
    status: text('status', { enum: emailStatuses }).notNull().default('queued'),
    providerId: text('provider_id'),
    /** Why it failed, in plain words, never with the address or the link. */
    failure: text('failure'),
    /** The pg-boss job whose run moved it to `sending` (as email_message's, #203). */
    claimedByJob: uuid('claimed_by_job'),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
    sentAt: time('sent_at'),
  },
  () => [
    check(
      'account_email_status_check',
      sql.raw("status in ('queued', 'sending', 'sent', 'failed')"),
    ),
  ],
);

export const rateLimitHit = pgTable(
  'rate_limit_hit',
  {
    id: id(),
    /** What is limited, and for whom: `sign-in:address:<sha-256>`, `sign-in:ip:<sha-256>`. Never a plain address. */
    bucket: text('bucket').notNull(),
    createdAt: time('created_at').notNull().defaultNow(),
  },
  (t) => [index('rate_limit_hit_bucket_created_at_idx').on(t.bucket, t.createdAt)],
);
