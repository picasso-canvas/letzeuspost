import type { Metadata } from 'next';
import { messages } from '../../messages.ts';
import { linkProblem } from './outcome.ts';
import { SignInForm } from './sign-in-form.tsx';

// §04 Public: /sign-in, for people with no session (the proxy sends signed-in ones to the Inbox). Built in the invite
// accept card's pattern (Q10): the logo, then one card. Nothing here reads the database or the session.
const { signIn } = messages;

export const metadata: Metadata = { title: `${signIn.heading} · ${messages.app.name}` };

/** The mark of the final logo (docs/design/logos/letzeuspost/mark.svg): the bolt on the gold fill, in tokens. */
function Mark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground"
    >
      <svg viewBox="8 4 44 56" className="h-4 fill-current">
        <path d="M39.5 6.5 L18.5 36 H31 L25 57.5 L46.5 27 H34.5 Z" />
      </svg>
    </span>
  );
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-6 px-6 pt-24 pb-12">
      <div className="flex items-center gap-2">
        <Mark />
        <span>
          {signIn.brand.let}
          <b className="font-bold">{signIn.brand.zeus}</b>
          {signIn.brand.post}
        </span>
      </div>
      <SignInForm linkProblem={linkProblem(error)} />
    </main>
  );
}
