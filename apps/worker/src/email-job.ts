// Stub: the email job comes in the next commit.
import type { JobHandler } from '@lzp/db';

export function emailJob(_deps: unknown): JobHandler<'email'> {
  return () => Promise.resolve();
}
