import { randomUUIDv7 } from 'node:crypto';
import type { EmailOutbox, JobContext, OutboxEmail, OutboxSkip, Scoped } from '@lzp/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailJob } from './email-job.ts';
import { log } from './log.ts';
import { NotSentError, SendOutcomeUnknownError, type OutgoingEmail } from './smtp.ts';

const workspaceId = randomUUIDv7();
const emailMessageId = randomUUIDv7();

// Everything personal or written in this email: none of it may reach a log (§13 Security summary).
const secrets = {
  to: 'nadia.rahman@golpo-cafe.example',
  replyTo: 'owner@northwind-social.example',
  name: 'নাদিয়া রহমান',
  subject: 'Your posts for Golpo Café are ready',
  html: '<p>Hello নাদিয়া, here is the caption: আমাদের নতুন মেনু</p>',
  text: 'Hello নাদিয়া, here is the caption: আমাদের নতুন মেনু',
};

const email: OutboxEmail = {
  id: emailMessageId,
  template: 'email-check',
  to: secrets.to,
  replyTo: secrets.replyTo,
  data: { name: secrets.name },
};

/** The steps after the send, each of which writes the row. */
type Bookkeeping = 'sent' | 'release' | 'fail';

/** As pg reports a connection the database dropped mid-query. */
const dropped = () => Promise.reject(new Error('Connection terminated unexpectedly'));

/** An outbox in memory that records each step. */
function fakeOutbox(found: { email: OutboxEmail } | { skip: OutboxSkip } = { email }) {
  const steps: string[] = [];
  let claimWins = true;
  let sentRecorded = true;
  let drop: Bookkeeping | undefined;
  const outbox: EmailOutbox = {
    load: (id, job) => {
      steps.push(`load ${id} for ${job}`);
      return Promise.resolve(found);
    },
    claim: (id, job) => {
      steps.push(`claim ${id} by ${job}`);
      return Promise.resolve(claimWins);
    },
    sent: (id, providerId) => {
      steps.push(`sent ${id} ${providerId}`);
      return drop === 'sent' ? dropped() : Promise.resolve(sentRecorded);
    },
    release: (id) => {
      steps.push(`release ${id}`);
      return drop === 'release' ? dropped() : Promise.resolve();
    },
    fail: (id, reason) => {
      steps.push(`fail ${id}: ${reason}`);
      return drop === 'fail' ? dropped() : Promise.resolve();
    },
  };
  return {
    steps,
    outbox,
    loseClaim: () => {
      claimWins = false;
    },
    recordNothing: () => {
      sentRecorded = false;
    },
    /** The database drops while `step` writes the row. */
    dropDuring: (step: Bookkeeping) => {
      drop = step;
    },
  };
}

function fakeTransport(result: () => Promise<{ providerId: string }>) {
  const sent: OutgoingEmail[] = [];
  return {
    sent,
    transport: {
      send: (message: OutgoingEmail) => {
        sent.push(message);
        return result();
      },
      close: () => undefined,
    },
  };
}

const render = vi.fn(() =>
  Promise.resolve({ subject: secrets.subject, html: secrets.html, text: secrets.text }),
);

/** pg-boss's id for the job; its retries keep it. */
const jobId = randomUUIDv7();

function context(lastAttempt = false): JobContext<'email'> {
  return {
    jobId,
    payload: { workspaceId, emailMessageId },
    db: {} as Scoped,
    retryCount: lastAttempt ? 3 : 0,
    lastAttempt,
  };
}

function job(
  outbox: EmailOutbox,
  transport: ReturnType<typeof fakeTransport>['transport'],
  renderEmail = render,
) {
  return emailJob({
    transport,
    render: renderEmail,
    from: 'LetZeusPost <noreply@letzeuspost.example>',
    appUrl: 'http://localhost:3000',
    log,
    outbox: () => outbox,
  });
}

/** Everything the process writes while a test runs, however it writes it. */
let written = '';
beforeEach(() => {
  written = '';
  const capture = (chunk: unknown) => {
    written += String(chunk);
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture);
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      capture(args.map(String).join(' '));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  // No email address, name, subject or content in anything the worker wrote (§13: no post text or emails in logs).
  for (const secret of Object.values(secrets)) expect(written).not.toContain(secret);
  expect(written).not.toContain('নাদিয়া');
  expect(written).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
});

describe('the email job', () => {
  it('renders the row, claims it, sends it once and records the provider id', async () => {
    const { steps, outbox } = fakeOutbox();
    const { sent, transport } = fakeTransport(() => Promise.resolve({ providerId: '<p-1>' }));
    await job(outbox, transport)(context());

    expect(render).toHaveBeenCalledWith(
      'email-check',
      { name: secrets.name },
      {
        appUrl: 'http://localhost:3000',
      },
    );
    expect(sent).toEqual([
      {
        from: 'LetZeusPost <noreply@letzeuspost.example>',
        to: secrets.to,
        replyTo: secrets.replyTo,
        subject: secrets.subject,
        html: secrets.html,
        text: secrets.text,
        messageId: `<${emailMessageId}@letzeuspost.example>`,
      },
    ]);
    expect(steps).toEqual([
      `load ${emailMessageId} for ${jobId}`,
      `claim ${emailMessageId} by ${jobId}`,
      `sent ${emailMessageId} <p-1>`,
    ]);
    expect(written).toContain(emailMessageId); // the log names the row by its id
  });

  it.each(['sent', 'failed', 'missing', 'interrupted', 'sending'] as const)(
    'leaves a row it finds %s alone, and sends nothing',
    async (skip) => {
      const { steps, outbox } = fakeOutbox({ skip });
      const { sent, transport } = fakeTransport(() => Promise.resolve({ providerId: '<p>' }));
      await job(outbox, transport)(context());
      expect(sent).toEqual([]);
      expect(steps).toEqual([`load ${emailMessageId} for ${jobId}`]);
    },
  );

  it('sends nothing when another run claimed the row first', async () => {
    const { steps, outbox, loseClaim } = fakeOutbox();
    loseClaim();
    const { sent, transport } = fakeTransport(() => Promise.resolve({ providerId: '<p>' }));
    await job(outbox, transport)(context());
    expect(sent).toEqual([]);
    expect(steps).toEqual([
      `load ${emailMessageId} for ${jobId}`,
      `claim ${emailMessageId} by ${jobId}`,
    ]);
  });

  it('fails a row whose template or data is refused, for good, before claiming it', async () => {
    const { steps, outbox } = fakeOutbox();
    const { sent, transport } = fakeTransport(() => Promise.resolve({ providerId: '<p>' }));
    const refuse = vi.fn(() => Promise.reject(new Error(`bad data for ${secrets.to}`)));
    await job(outbox, transport, refuse)(context());
    expect(sent).toEqual([]);
    expect(steps).toEqual([
      `load ${emailMessageId} for ${jobId}`,
      `fail ${emailMessageId}: its template or data was refused`,
    ]);
  });

  it('puts the row back and lets the job retry when the email certainly did not go out', async () => {
    const { steps, outbox } = fakeOutbox();
    const { transport } = fakeTransport(() => Promise.reject(new NotSentError('smtp-451')));
    await expect(job(outbox, transport)(context())).rejects.toThrow('smtp-451');
    expect(steps.at(-1)).toBe(`release ${emailMessageId}`);
  });

  it('fails the row on the last attempt when the email still did not go out', async () => {
    const { steps, outbox } = fakeOutbox();
    const { transport } = fakeTransport(() => Promise.reject(new NotSentError('ECONNECTION')));
    await expect(job(outbox, transport)(context(true))).rejects.toThrow('ECONNECTION');
    expect(steps.at(-1)).toBe(`fail ${emailMessageId}: not sent (ECONNECTION)`);
  });

  it('fails the row at once when it may have gone out, so no retry sends it again', async () => {
    const { steps, outbox } = fakeOutbox();
    const { transport } = fakeTransport(() =>
      Promise.reject(new SendOutcomeUnknownError('ESOCKET')),
    );
    await expect(job(outbox, transport)(context())).rejects.toThrow('ESOCKET');
    expect(steps).toEqual([
      `load ${emailMessageId} for ${jobId}`,
      `claim ${emailMessageId} by ${jobId}`,
      `fail ${emailMessageId}: the send broke off (ESOCKET): it may have gone out, so it is not sent again`,
    ]);
  });

  it('says so in the log when the send went out but the row could not record it', async () => {
    const { outbox, recordNothing } = fakeOutbox();
    recordNothing();
    const { sent, transport } = fakeTransport(() => Promise.resolve({ providerId: '<p-2>' }));
    await job(outbox, transport)(context());
    expect(sent).toHaveLength(1);
    expect(written).toContain('"event":"email.unrecorded"');
    expect(written).not.toContain('"event":"email.sent"');
  });

  // Argus F1 on #197: the row is left `sending`, claimed by this job. The run fails, so pg-boss retries the job (same
  // id), and the retry's load finds its own claim and marks the row interrupted (email-outbox.ts; the int tests).
  it.each([
    ['sent', () => Promise.resolve({ providerId: '<p-3>' })],
    ['release', () => Promise.reject(new NotSentError('smtp-451'))],
    ['fail', () => Promise.reject(new SendOutcomeUnknownError('ESOCKET'))],
  ] as const)(
    'fails the run, for pg-boss to retry, when the database drops during %s()',
    async (step, send) => {
      const { steps, outbox, dropDuring } = fakeOutbox();
      dropDuring(step);
      const { sent, transport } = fakeTransport(send);
      await expect(job(outbox, transport)(context())).rejects.toThrow();
      expect(sent).toHaveLength(1);
      expect(steps.slice(0, 2)).toEqual([
        `load ${emailMessageId} for ${jobId}`,
        `claim ${emailMessageId} by ${jobId}`,
      ]);
      expect(steps.at(-1)).toMatch(new RegExp(`^${step} ${emailMessageId}`));
    },
  );

  it('never repeats a thrown error’s own words, which may hold the address', async () => {
    const { outbox } = fakeOutbox();
    const { transport } = fakeTransport(() =>
      Promise.reject(new Error(`550 <${secrets.to}> rejected`)),
    );
    const failure = await job(outbox, transport)(context()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(secrets.to);
    expect((failure as Error).cause).toBeUndefined();
  });
});
