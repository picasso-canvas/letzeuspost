// The sign-in link email (#77, §13 Sign-in and sessions): one button, the link Better Auth made, which works once and
// for 10 minutes (A5). packages/auth writes the row in the account emails' outbox; the worker renders and sends it.
// The link must lead into the app's sign-in routes (APP_URL + /api/auth/): a row holding any other link is refused,
// never sent, so a forged row can't send people elsewhere in our name.
import { Layout } from '../layout.tsx';
import { EmailTemplateError, type Template } from '../template.ts';

export interface SignInLinkData {
  readonly url: string;
}

const MAX_URL = 2000;
const SIGN_IN_PATH = '/api/auth/';

/** The refusal never repeats the link: it holds a token that signs someone in. */
const refused = () =>
  new EmailTemplateError(
    `sign-in-link: its data needs a url of at most ${String(MAX_URL)} characters under the app's ${SIGN_IN_PATH}`,
  );

export const signInLink: Template<SignInLinkData> = {
  parse(data) {
    const url =
      typeof data === 'object' && data !== null ? (data as { url?: unknown }).url : undefined;
    if (typeof url !== 'string' || url.length > MAX_URL) throw refused();
    const parsed = URL.parse(url);
    if (parsed === null || !['http:', 'https:'].includes(parsed.protocol)) throw refused();
    if (!parsed.pathname.startsWith(SIGN_IN_PATH)) throw refused();
    return { url };
  },
  subject: () => 'Your LetZeusPost sign-in link',
  render: ({ url }, { appUrl }) => {
    if (URL.parse(url)?.origin !== URL.parse(appUrl)?.origin) throw refused();
    return (
      <Layout
        preview="Your sign-in link. It works once, for 10 minutes."
        heading="Sign in to LetZeusPost"
        paragraphs={[
          'Use the button below to sign in. The link works once, for 10 minutes.',
          'If you didn’t ask to sign in, you can ignore this email. Nobody can sign in without this link.',
        ]}
        button={{ label: 'Sign in', href: url }}
      />
    );
  },
};
