// Email templates (React Email), compiled with tsc to dist; the worker imports the built output and renders there (Q8).
// Each email has an HTML and a plain-text version, made from the same render (§13 Repo layout, §23).
import { render } from '@react-email/render';
import type { ReactElement } from 'react';
import { emailCheck } from './email-check.tsx';
import { EmailTemplateError, type EmailContext, type Template } from './template.ts';
import { signInLink } from './templates/sign-in-link.tsx';

export { EmailTemplateError, type EmailContext } from './template.ts';

/** A template that checks its own data, so templates with different data sit in one list. */
type Compose = (data: unknown, context: EmailContext) => { subject: string; element: ReactElement };

function composer<Data>(template: Template<Data>): Compose {
  return (data, context) => {
    const parsed = template.parse(data);
    return { subject: template.subject(parsed), element: template.render(parsed, context) };
  };
}

const templates: Readonly<Record<string, Compose>> = {
  'email-check': composer(emailCheck),
  'sign-in-link': composer(signInLink),
};

/** The names an outbox row's `template` may hold. */
export const templateNames: readonly string[] = Object.keys(templates);

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** Renders a stored message: refuses an unknown template or data the template doesn't accept. */
export async function renderTemplate(
  name: string,
  data: unknown,
  context: EmailContext,
): Promise<RenderedEmail> {
  const compose = Object.hasOwn(templates, name) ? templates[name] : undefined;
  if (compose === undefined) throw new EmailTemplateError('no such email template');
  const { subject, element } = compose(data, context);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}
