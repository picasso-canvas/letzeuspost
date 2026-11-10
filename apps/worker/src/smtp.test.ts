import { describe, expect, it } from 'vitest';
import { NotSentError, SendOutcomeUnknownError, sendFailure } from './smtp.ts';

/** An error shaped like nodemailer's: its message often quotes the server, which may name the address. */
function smtpError(fields: Record<string, unknown>): Error {
  return Object.assign(
    new Error('550 5.1.1 <nadia@example.com>: Recipient address rejected'),
    fields,
  );
}

describe('sendFailure: did the email certainly not go out?', () => {
  it.each([
    ['the server refused it (5xx)', { code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' }],
    [
      'the server refused it for now (4xx)',
      { code: 'EMESSAGE', responseCode: 451, command: 'DATA' },
    ],
    ['no connection', { code: 'ECONNECTION', command: 'CONN' }],
    ['no such host', { code: 'EDNS' }],
    ['sign-in to the server failed', { code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN' }],
    ['the connection timed out before it opened', { code: 'ETIMEDOUT', command: 'CONN' }],
  ])('%s: not sent, so a retry may send it', (_, fields) => {
    expect(sendFailure(smtpError(fields))).toBeInstanceOf(NotSentError);
  });

  it.each([
    ['the connection dropped mid-message', { code: 'ESOCKET', command: 'DATA' }],
    ['the reply never came', { code: 'ETIMEDOUT' }],
    ['an error with no code', {}],
    ['something that is not an error', undefined],
  ])('%s: it may have gone out, so it is never sent again', (_, fields) => {
    const error = fields === undefined ? 'boom' : smtpError(fields);
    expect(sendFailure(error)).toBeInstanceOf(SendOutcomeUnknownError);
  });

  it("keeps the code and drops the server's words, which may hold the address", () => {
    const failure = sendFailure(smtpError({ code: 'EENVELOPE', responseCode: 550 }));
    expect(failure.code).toBe('smtp-550');
    expect(failure.message).not.toContain('nadia');
    expect(failure.message).not.toContain('Recipient');
    expect(failure.cause).toBeUndefined();
  });
});
