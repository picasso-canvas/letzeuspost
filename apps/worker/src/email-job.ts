// The `email` job (§13 Jobs, #72): sends one outbox row. Its payload is the row's id; the address, the template and
// its data are read from the row, in the job's workspace. Safe to run twice (packages/db's email-outbox.ts):
//   1. load the row: only a queued row goes on (sent, failed, gone, interrupted, or being sent by another run: left
//      alone);
//   2. render it (Q8: @lzp/email's built output, in this process); a template or data it refuses fails the row;
//   3. claim it (queued → sending, one conditional update: a second run finds it taken);
//   4. send it; then mark it sent, or put it back if it certainly didn't go out, or fail it if it may have.
// The log names the row by id and the outcome by code: never the address, the subject or the content.
import { emailOutbox, type EmailOutbox, type JobHandler, type Scoped } from '@lzp/db';
import type { EmailContext, RenderedEmail } from '@lzp/email';
import type { Log } from './log.ts';
import { NotSentError, SendOutcomeUnknownError, type EmailTransport } from './smtp.ts';

export interface EmailJobDeps {
  readonly transport: EmailTransport;
  /** @lzp/email's renderTemplate. */
  readonly render: (
    template: string,
    data: unknown,
    context: EmailContext,
  ) => Promise<RenderedEmail>;
  /** EMAIL_FROM. */
  readonly from: string;
  /** APP_URL, for the button. */
  readonly appUrl: string;
  readonly log: Log;
  /** The outbox of the job's workspace; packages/db's by default. */
  readonly outbox?: (db: Scoped) => EmailOutbox;
}

export const REFUSED = 'its template or data was refused';

/** The row's failure when the send broke off after the message may have reached the server. */
export function mayHaveGoneOut(code: string): string {
  return `the send broke off (${code}): it may have gone out, so it is not sent again`;
}

/** `<row id@sender's domain>`: one Message-ID per row, however many times its job runs. */
function messageIdFor(id: string, from: string): string {
  const domain = /@([^\s>]+)>?\s*$/.exec(from)?.[1] ?? 'letzeuspost.invalid';
  return `<${id}@${domain}>`;
}

export function emailJob(deps: EmailJobDeps): JobHandler<'email'> {
  const outboxOf = deps.outbox ?? emailOutbox;
  return async ({ jobId, payload, db, lastAttempt }) => {
    const id = payload.emailMessageId;
    const outbox = outboxOf(db);
    const said = (event: string, fields: Record<string, string> = {}) => {
      deps.log(event, { jobId, emailMessageId: id, ...fields });
    };

    const found = await outbox.load(id);
    if ('skip' in found) {
      said('email.skipped', { reason: found.skip });
      return;
    }
    const { email } = found;

    let rendered: RenderedEmail;
    try {
      rendered = await deps.render(email.template, email.data, { appUrl: deps.appUrl });
    } catch {
      // Rendering is the same every time, so a retry wouldn't help.
      await outbox.fail(id, REFUSED);
      said('email.failed', { reason: 'refused' });
      return;
    }

    if (!(await outbox.claim(id))) {
      said('email.skipped', { reason: 'claimed' });
      return;
    }

    let providerId: string;
    try {
      ({ providerId } = await deps.transport.send({
        from: deps.from,
        to: email.to,
        ...(email.replyTo === null ? {} : { replyTo: email.replyTo }),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        messageId: messageIdFor(id, deps.from),
      }));
    } catch (error) {
      if (error instanceof NotSentError) {
        if (lastAttempt) {
          await outbox.fail(id, `not sent (${error.code})`);
          said('email.failed', { code: error.code });
        } else {
          await outbox.release(id);
          said('email.retry', { code: error.code });
        }
        throw new NotSentError(error.code);
      }
      // Perhaps sent: failed now, so no retry sends it again (a retry would find it `sending` and not yet stale).
      const code = error instanceof SendOutcomeUnknownError ? error.code : 'unknown';
      await outbox.fail(id, mayHaveGoneOut(code));
      said('email.unknown', { code });
      throw new SendOutcomeUnknownError(code);
    }
    // False only if the row left `sending` for another reason than an interrupted retry (it was deleted, say).
    said((await outbox.sent(id, providerId)) ? 'email.sent' : 'email.unrecorded');
  };
}
