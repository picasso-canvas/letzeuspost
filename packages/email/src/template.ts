import type { ReactElement } from 'react';

/** What every template may use besides its own data. */
export interface EmailContext {
  /** The app's URL (config/env.ts's APP_URL), for the button. */
  readonly appUrl: string;
}

/**
 * One email. `parse` checks the data stored with the message before anything renders; its errors name what's wrong,
 * never the value, since the data holds names and addresses (§13: no emails in logs).
 */
export interface Template<Data> {
  parse: (data: unknown) => Data;
  subject: (data: Data) => string;
  render: (data: Data, context: EmailContext) => ReactElement;
}

/** A template that doesn't exist, or data it refuses. Safe to log: it never holds the data. */
export class EmailTemplateError extends Error {
  override name = 'EmailTemplateError';
}
