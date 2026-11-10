// The email outbox (§13 Data model, Messages; #72): how an email is queued and how its job moves the row along, so a
// retried job never sends twice. Every step runs through `db.forWorkspace`, so a job sees only its workspace's rows.
//
//   queued ──claim──▶ sending ──sent──▶ sent
//     ▲                  │
//     └────release───────┤   (the provider refused it, or it never reached the provider: safe to send again)
//                        └──fail──▶ failed
//
// A row is sent only from `queued`, and the claim that moves it to `sending` is one conditional update, so two runs
// of one job can't both send it. A row found in `sending` is another run's:
// - while it is younger than the email job's expiry, that run may still be sending it, so it is left alone;
// - once older, its run was killed (pg-boss retries a killed job only after it expires, and a retry waits at least
//   30 s more): it may have gone out, so it is never sent again, and is marked failed as interrupted.
// A run that outlived its job and did send it still records the send (`sent` moves an interrupted row too), so the
// row says what happened. A send whose outcome is unknown fails the row at once (apps/worker's email job).
import { and, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Db, Scoped, WorkspaceCtx } from '../db.ts';
import { emailMessage } from '../schema/email-message.ts';
import type { Jobs } from './boss.ts';
import { queues } from './queues.ts';

export interface OutboxEmail {
  readonly id: string;
  readonly template: string;
  readonly to: string;
  readonly replyTo: string | null;
  readonly data: unknown;
}

/**
 * Why a job leaves its row alone: no such row in this workspace, already sent, already failed, interrupted, or another
 * run is sending it now.
 */
export type OutboxSkip = 'missing' | 'sent' | 'failed' | 'interrupted' | 'sending';

export const INTERRUPTED =
  'interrupted while sending: it may have gone out, so it is not sent again';

/** A `sending` row older than this lost its run: the email job's expiry, after which pg-boss retries the job. */
export const SENDING_STALE_AFTER_SECONDS = queues.email.queue.expireInSeconds;

export interface EmailOutbox {
  /**
   * The row if it is waiting to be sent; otherwise why not. A `sending` row older than the job's expiry is marked
   * failed as interrupted here; a younger one is left to the run sending it.
   */
  load: (id: string) => Promise<{ email: OutboxEmail } | { skip: OutboxSkip }>;
  /** queued → sending. False when another run took it first. */
  claim: (id: string) => Promise<boolean>;
  /**
   * sending → sent, with the provider's message id; an interrupted row too, since its run did send it after all.
   * False when the row was neither (gone, or failed for another reason).
   */
  sent: (id: string, providerId: string) => Promise<boolean>;
  /** sending → queued: it certainly didn't go out, so a retry may send it. */
  release: (id: string) => Promise<void>;
  /** → failed, with a plain reason that never holds the address or the content. */
  fail: (id: string, reason: string) => Promise<void>;
}

export function emailOutbox(db: Scoped): EmailOutbox {
  const now = sql`now()`;
  const sending = eq(emailMessage.status, 'sending');
  /** Moves the row when `from` holds; true if it moved. One conditional update, so two runs can't both move it. */
  const move = async (
    id: string,
    from: SQL | undefined,
    set: PgUpdateSetSource<typeof emailMessage>,
  ): Promise<boolean> => {
    const moved = await db.transaction((tx) =>
      tx
        .update(emailMessage)
        .set({ ...set, updatedAt: now })
        .where(and(eq(emailMessage.id, id), from))
        .returning({ id: emailMessage.id }),
    );
    return moved.length === 1;
  };

  return {
    load: async (id) => {
      const [row] = await db.transaction((tx) =>
        tx
          .select({
            id: emailMessage.id,
            template: emailMessage.template,
            to: emailMessage.toAddress,
            replyTo: emailMessage.replyTo,
            data: emailMessage.data,
            status: emailMessage.status,
          })
          .from(emailMessage)
          .where(eq(emailMessage.id, id)),
      );
      if (row === undefined) return { skip: 'missing' };
      if (row.status === 'sending') {
        // Stale is checked in the update itself, so a row another run has just claimed again is never caught.
        const stale = lt(
          emailMessage.updatedAt,
          sql`now() - make_interval(secs => ${SENDING_STALE_AFTER_SECONDS})`,
        );
        const interrupted = await move(id, and(sending, stale), {
          status: 'failed',
          failure: INTERRUPTED,
        });
        return { skip: interrupted ? 'interrupted' : 'sending' };
      }
      if (row.status !== 'queued') return { skip: row.status };
      return {
        email: {
          id: row.id,
          template: row.template,
          to: row.to,
          replyTo: row.replyTo,
          data: row.data,
        },
      };
    },
    claim: (id) => move(id, eq(emailMessage.status, 'queued'), { status: 'sending' }),
    sent: (id, providerId) =>
      move(
        id,
        or(sending, and(eq(emailMessage.status, 'failed'), eq(emailMessage.failure, INTERRUPTED))),
        { status: 'sent', providerId, sentAt: now, failure: null },
      ),
    release: async (id) => {
      await move(id, sending, { status: 'queued' });
    },
    fail: async (id, reason) => {
      await move(id, inArray(emailMessage.status, ['queued', 'sending']), {
        status: 'failed',
        failure: reason,
      });
    },
  };
}

export interface NewEmail {
  /** A template name from @lzp/email. */
  readonly template: string;
  readonly to: string;
  readonly replyTo?: string;
  /** The template's data; the template checks it before it renders. */
  readonly data: Readonly<Record<string, unknown>>;
}

const address = z.email();

/**
 * Writes the row and its `email` job in one transaction of the workspace, so an email is queued exactly when its row
 * exists. Returns the row's id.
 */
export async function queueEmail(
  jobs: Jobs,
  db: Db,
  ctx: WorkspaceCtx,
  email: NewEmail,
): Promise<string> {
  for (const value of [email.to, ...(email.replyTo === undefined ? [] : [email.replyTo])]) {
    if (!address.safeParse(value).success) throw new Error('queueEmail: not an email address');
  }
  return db.forWorkspace(ctx).transaction(async (tx) => {
    const [row] = await tx
      .insert(emailMessage)
      .values({
        workspaceId: ctx.workspaceId,
        template: email.template,
        toAddress: email.to,
        replyTo: email.replyTo ?? null,
        data: email.data,
      })
      .returning({ id: emailMessage.id });
    if (row === undefined) throw new Error('queueEmail: the row was not written');
    await jobs.send('email', { workspaceId: ctx.workspaceId, emailMessageId: row.id }, { tx });
    return row.id;
  });
}
