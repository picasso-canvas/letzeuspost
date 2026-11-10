// The email check: proves an email goes from the outbox through the worker to the inbox (#64, #72). The product's own
// emails (sign-in #77, invitations, §23's onboarding emails) come with their features, each as a template beside this.
import { Layout } from './layout.tsx';
import { EmailTemplateError, type Template } from './template.ts';

export interface EmailCheckData {
  /** Whom it greets: a person's or an agency's name. */
  readonly name: string;
}

const MAX_NAME = 200;

export const emailCheck: Template<EmailCheckData> = {
  parse(data) {
    const name =
      typeof data === 'object' && data !== null ? (data as { name?: unknown }).name : undefined;
    if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_NAME) {
      throw new EmailTemplateError(
        `email-check: its data needs a name of 1 to ${String(MAX_NAME)} characters`,
      );
    }
    return { name };
  },
  subject: () => 'LetZeusPost email check',
  render: ({ name }, { appUrl }) => (
    <Layout
      preview="Your emails from LetZeusPost arrive."
      heading="Email check"
      paragraphs={[`Hello ${name},`, 'this email shows that messages from LetZeusPost reach you.']}
      button={{ label: 'Open LetZeusPost', href: appUrl }}
    />
  ),
};
