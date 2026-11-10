// Stub: the transport comes in the next commit.
export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  messageId: string;
}
export class NotSentError extends Error {
  constructor(readonly code: string) {
    super();
  }
}
export class SendOutcomeUnknownError extends Error {
  constructor(readonly code: string) {
    super();
  }
}
export function sendFailure(error: unknown): NotSentError | SendOutcomeUnknownError {
  return new NotSentError(String(error));
}
