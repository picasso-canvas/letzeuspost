import type { Metadata } from 'next';
import { LogoMark } from '@lzp/ui/components/logo-mark';
import { messages } from '../../messages.ts';
import { linkProblem } from './outcome.ts';
import { SignInForm } from './sign-in-form.tsx';

// §04 Public: /sign-in, for people with no session (the proxy sends signed-in ones to the Inbox). Built in the invite
// accept card's pattern (Q10): the logo, then one card 520 px wide, 48 px from the top (the mockup's 52 px). Nothing
// here reads the database or the session.
const { signIn } = messages;

export const metadata: Metadata = { title: `${signIn.heading} · ${messages.app.name}` };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { error } = await searchParams;
  return (
    <main className="min-h-dvh px-6 pt-12 pb-12">
      <div className="mx-auto flex w-full max-w-130 flex-col gap-6">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span>
            {signIn.brand.let}
            <b className="font-bold">{signIn.brand.zeus}</b>
            {signIn.brand.post}
          </span>
        </div>
        <SignInForm linkProblem={linkProblem(error)} />
      </div>
    </main>
  );
}
