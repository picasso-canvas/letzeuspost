// The email outbox (§13 Data model, Messages; #72): one row per email, written before its job is queued, so a retried
// job finds the row's status and never sends twice. The job's payload carries only the row's id (§13 Jobs); the
// address, the template and its data stay here, under row-level security, out of the queue and out of the logs.
//
// Written by hand in ../../migrations/0003_email_message.sql (§13 A4), like the tables in ./accounts.ts. Change both
// together.
import { sql } from 'drizzle-orm';
import { check, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspace } from './accounts.ts';

/**
 * queued: waiting for its job. sending: a run has started sending it. sent: the provider took it (`provider_id`).
 * failed: given up, with a plain reason in `failure`. A row is never sent again once it has left `queued`.
 */
export const emailStatuses = ['queued', 'sending', 'sent', 'failed'] as const;
export type EmailStatus = (typeof emailStatuses)[number];

const time = (name: string) => timestamp(name, { withTimezone: true });
const scope = sql.raw("workspace_id = current_setting('app.workspace_id')::uuid");

export const emailMessage = pgTable(
  'email_message',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** A template name from @lzp/email. */
    template: text('template').notNull(),
    toAddress: text('to_address').notNull(),
    replyTo: text('reply_to'),
    /** The template's data, checked by the template before it renders. */
    data: jsonb('data').notNull().default({}),
    status: text('status', { enum: emailStatuses }).notNull().default('queued'),
    /** The provider's message id, once sent. */
    providerId: text('provider_id'),
    /** Why it failed, in plain words, never with the address or the content. */
    failure: text('failure'),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
    sentAt: time('sent_at'),
  },
  () => [
    check(
      'email_message_status_check',
      sql.raw("status in ('queued', 'sending', 'sent', 'failed')"),
    ),
    // §13's policy, as §13 writes it.
    pgPolicy('workspace_scope', { for: 'all', using: scope, withCheck: scope }),
  ],
);
