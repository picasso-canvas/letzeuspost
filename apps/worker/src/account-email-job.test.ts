// The `account-email` job (#77, Athena's decision 3): it sends one row of the account emails' outbox, which packages/auth
// gives the worker, through the same steps as the `email` job (email-job.test.ts covers each of them). A sign-in link
// is a person's, so the job has no workspace: its payload is the row's id alone.
import { randomUUIDv7 } from 'node:crypto';
import type { EmailOutbox, JobContext, OutboxEmail, OutboxSkip } from '@lzp/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountEmailJob } from './account-email-job.ts';
import { log } from './log.ts';
import { NotSentError, type OutgoingEmail } from './smtp.ts';

const accountEmailId = randomUUIDv7();
const jobId = randomUUIDv7();
const to = 'nadia.rahman@golpo-cafe.example';
const link =
  'http://localhost:3000/api/auth/magic-link/verify?token=AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf';

const email: OutboxEmail = {
  id: accountEmailId,
  template: 'sign-in-link',
  to,
  replyTo: null,
  data: { url: link },
};

/** The account emails' outbox in memory: one row, moved as the real one moves it. */
function fakeOutbox() {
  let status: 'queued' | 'sending' | 'sent' | 'failed' = 'queued';
  const steps: string[] = [];
  const outbox: EmailOutbox = {
    load: () => {
      steps.push('load');
      const skip: OutboxSkip | null = status === 'queued' ? null : status;
      return Promise.resolve(skip === null ? { email } : { skip });
    },
    claim: () => {
      steps.push('claim');
      if (status !== 'queued') return Promise.resolve(false);
      status = 'sending';
      return Promise.resolve(true);
    },
    sent: () => {
      steps.push('sent');
      status = 'sent';
      return Promise.resolve(true);
    },
    release: () => {
      steps.push('release');
      status = 'queued';
      return Promise.resolve();
    },
    fail: (_id, reason) => {
      steps.push(`fail: ${reason}`);
      status = 'failed';
      return Promise.resolve();
    },
  };
  return { outbox, steps };
}

function context(lastAttempt = false): JobContext<'account-email'> {
  return { jobId, payload: { accountEmailId }, db: null, retryCount: 0, lastAttempt };
}

const render = vi.fn((template: string, data: unknown) =>
  Promise.resolve({
    subject: template,
    html: JSON.stringify(data),
    text: JSON.stringify(data),
  }),
);

function setup(send: (message: OutgoingEmail) => Promise<{ providerId: string }>) {
  const { outbox, steps } = fakeOutbox();
  const sent: OutgoingEmail[] = [];
  const handler = accountEmailJob({
    outbox,
    transport: {
      send: (message) => {
        sent.push(message);
        return send(message);
      },
      close: () => undefined,
    },
    render,
    from: 'LetZeusPost <noreply@letzeuspost.example>',
    appUrl: 'http://localhost:3000',
    log,
  });
  return { handler, steps, sent };
}

/** The log's lines, kept out of the test run's output. */
let lines: string[] = [];

beforeEach(() => {
  lines = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the account-email job', () => {
  it('sends the row once, with its template and link, and a second run leaves it alone', async () => {
    const { handler, steps, sent } = setup(() => Promise.resolve({ providerId: '<p1>' }));
    await handler(context());
    await handler(context());
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(to);
    expect(sent[0]?.text).toContain(link);
    expect(render).toHaveBeenCalledWith(
      'sign-in-link',
      { url: link },
      { appUrl: 'http://localhost:3000' },
    );
    expect(sent[0]?.messageId).toBe(`<${accountEmailId}@letzeuspost.example>`);
    expect(steps).toEqual(['load', 'claim', 'sent', 'load']);
  });

  it('puts the row back for a retry when the send certainly failed, and fails it on the last try', async () => {
    const refused = () => Promise.reject(new NotSentError('ECONNECTION'));
    const first = setup(refused);
    await expect(first.handler(context())).rejects.toThrow(NotSentError);
    expect(first.steps).toEqual(['load', 'claim', 'release']);

    const last = setup(refused);
    await expect(last.handler(context(true))).rejects.toThrow(NotSentError);
    expect(last.steps).toEqual(['load', 'claim', 'fail: not sent (ECONNECTION)']);
  });

  it('logs the row by id and never the address or the link', async () => {
    const { handler } = setup(() => Promise.resolve({ providerId: '<p1>' }));
    await handler(context());
    const written = lines.join('');
    expect(written).toContain(accountEmailId);
    expect(written).toContain('email.sent');
    expect(written).not.toMatch(/nadia|golpo|token|magic-link/i);
  });
});
