// Sending email over SMTP with nodemailer (Q3: Mailpit catches it in development; the provider for staging and
// production comes with the partner launch). A failed send is sorted into one of two kinds, because the outbox treats
// them differently: certainly not sent (a retry may send it), or perhaps sent (never sent again).
import nodemailer from 'nodemailer';

export interface OutgoingEmail {
  readonly from: string;
  readonly to: string;
  readonly replyTo?: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** Our own Message-ID, from the outbox row, so the provider and the inbox see one id per row. */
  readonly messageId: string;
}

export interface EmailTransport {
  /** Resolves with the provider's message id; rejects with NotSentError or SendOutcomeUnknownError. */
  send: (email: OutgoingEmail) => Promise<{ providerId: string }>;
  close: () => void;
}

/**
 * The email certainly didn't go out: no connection, or the server refused it. Carries only a code: the server's
 * words often quote the address (§13: no emails in logs).
 */
export class NotSentError extends Error {
  override name = 'NotSentError';
  readonly code: string;
  constructor(code: string) {
    super(`email not sent (${code})`);
    this.code = code;
  }
}

/** The send broke off after the message may have reached the server. */
export class SendOutcomeUnknownError extends Error {
  override name = 'SendOutcomeUnknownError';
  readonly code: string;
  constructor(code: string) {
    super(`email may have been sent (${code})`);
    this.code = code;
  }
}

/** nodemailer's codes for failures before any message reached the server. */
const BEFORE_THE_MESSAGE = new Set([
  'ECONNECTION',
  'EDNS',
  'EAUTH',
  'ENOAUTH',
  'ETLS',
  'EENVELOPE',
]);

/** Sorts a nodemailer failure, keeping its code and never its message. */
export function sendFailure(error: unknown): NotSentError | SendOutcomeUnknownError {
  const { code, responseCode, command } =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown; responseCode?: unknown; command?: unknown })
      : {};
  // The server answered with a refusal: it didn't take the message.
  if (typeof responseCode === 'number' && responseCode >= 400 && responseCode < 600) {
    return new NotSentError(`smtp-${String(responseCode)}`);
  }
  const name = typeof code === 'string' && /^E[A-Z0-9]+$/.test(code) ? code : 'unknown';
  if (BEFORE_THE_MESSAGE.has(name) || command === 'CONN') return new NotSentError(name);
  return new SendOutcomeUnknownError(name);
}

/** The transport for SMTP_URL (config/env.ts). */
export function smtpTransport(url: string): EmailTransport {
  const transporter = nodemailer.createTransport(url);
  return {
    send: async (email) => {
      try {
        const info = await transporter.sendMail({ ...email });
        return { providerId: info.messageId };
      } catch (error) {
        throw sendFailure(error);
      }
    },
    close: () => {
      transporter.close();
    },
  };
}
