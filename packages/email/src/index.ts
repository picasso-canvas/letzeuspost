// Email templates (React Email), compiled with tsc to dist; the worker imports the built output (Q8).
import { render } from '@react-email/render';
import type { ReactElement } from 'react';

export { EmailCheck } from './email-check.tsx';

/** A template rendered to a complete HTML document. */
export async function renderToHtml(element: ReactElement): Promise<string> {
  return render(element);
}
