// The account emails' outbox (#77, Athena's decision 3, 2026-11-11): email_message's steps (./email-outbox.ts) on the
// `account_email` table, through the auth handle (lzp_auth), the only role that reaches it. A sign-in link is a
// person's, not a workspace's, so it never sits in a workspace's rows: it waits here, and the `account-email` job's
// payload holds only the row's id. Exported from @lzp/db/auth alone; the worker gets these steps from packages/auth.
//
// The states and the claim are email_message's (see its diagram): a row is sent only from `queued`, by one conditional
// update, so two runs of one job can't both send it, and a row found `sending` is left to its run or marked
// interrupted, never sent again. One difference: the link leaves `data` when the row is sent or fails, so a row keeps
// it only while it may still go out.
import { and, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Orm } from '../db.ts';
import { accountEmail } from '../schema/auth-only.ts';
import type { Jobs } from './boss.ts';
import {
  INTERRUPTED,
  SENDING_STALE_AFTER_SECONDS,
  type EmailOutbox,
  type OutboxEmail,
} from './email-outbox.ts';

/** What `fail` leaves when the job couldn't be queued: no job will ever send the row. */
export const NOT_QUEUED = 'its job was not queued';

/** The account emails' outbox, on the auth handle's database (`AuthDb.db`). */
export function accountEmailOutbox(orm: Orm): EmailOutbox {
  const now = sql`now()`;
  const sending = eq(accountEmail.status, 'sending');
  /** Leaving for `sent` or `failed`: the link goes with it. */
  const done = { data: {}, updatedAt: now };
  const move = async (
    id: string,
    from: SQL,
    set: PgUpdateSetSource<typeof accountEmail>,
  ): Promise<boolean> => {
    const moved = await orm
      .update(accountEmail)
      .set({ updatedAt: now, ...set })
      .where(and(eq(accountEmail.id, id), from))
      .returning({ id: accountEmail.id });
    return moved.length === 1;
  };

  return {
    load: async (id, jobId) => {
      const [row] = await orm
        .select({
          id: accountEmail.id,
          template: accountEmail.template,
          to: accountEmail.toAddress,
          data: accountEmail.data,
          status: accountEmail.status,
        })
        .from(accountEmail)
        .where(eq(accountEmail.id, id));
      if (row === undefined) return { skip: 'missing' };
      if (row.status === 'sending') {
        const stale = lt(
          accountEmail.updatedAt,
          sql`now() - make_interval(secs => ${SENDING_STALE_AFTER_SECONDS})`,
        );
        const ours = eq(accountEmail.claimedByJob, jobId);
        const interrupted = await move(id, sql`(${sending} and (${ours} or ${stale}))`, {
          ...done,
          status: 'failed',
          failure: INTERRUPTED,
        });
        return { skip: interrupted ? 'interrupted' : 'sending' };
      }
      if (row.status !== 'queued') return { skip: row.status };
      const email: OutboxEmail = {
        id: row.id,
        template: row.template,
        to: row.to,
        replyTo: null,
        data: row.data,
      };
      return { email };
    },
    claim: (id, jobId) =>
      move(id, eq(accountEmail.status, 'queued'), { status: 'sending', claimedByJob: jobId }),
    sent: (id, providerId) =>
      move(
        id,
        sql`(${sending} or (${eq(accountEmail.status, 'failed')} and ${eq(accountEmail.failure, INTERRUPTED)}))`,
        { ...done, status: 'sent', providerId, sentAt: now, failure: null },
      ),
    release: async (id) => {
      await move(id, sending, { status: 'queued', claimedByJob: null });
    },
    fail: async (id, reason) => {
      await move(id, inArray(accountEmail.status, ['queued', 'sending']), {
        ...done,
        status: 'failed',
        failure: reason,
      });
    },
  };
}

export interface NewAccountEmail {
  /** The person it is for: only an existing account gets one (Q9). */
  readonly userId: string;
  /** A template name from @lzp/email. */
  readonly template: string;
  readonly to: string;
  /** The template's data; the template checks it before it renders. */
  readonly data: Readonly<Record<string, unknown>>;
}

const address = z.email();

/**
 * Writes the row, then queues its `account-email` job. The two can't share a transaction: the row is lzp_auth's and
 * the queue lzp_app's. So the row comes first, and if the job can't be queued, the row is failed (no job would ever
 * send it) and the error goes on to the caller. Returns the row's id.
 */
export async function queueAccountEmail(
  orm: Orm,
  jobs: Pick<Jobs, 'send'>,
  email: NewAccountEmail,
): Promise<string> {
  if (!address.safeParse(email.to).success) {
    throw new Error('queueAccountEmail: not an email address');
  }
  const [row] = await orm
    .insert(accountEmail)
    .values({
      userId: email.userId,
      template: email.template,
      toAddress: email.to,
      data: email.data,
    })
    .returning({ id: accountEmail.id });
  if (row === undefined) throw new Error('queueAccountEmail: the row was not written');
  try {
    await jobs.send('account-email', { accountEmailId: row.id });
  } catch (error) {
    await accountEmailOutbox(orm).fail(row.id, NOT_QUEUED);
    throw error;
  }
  return row.id;
}
