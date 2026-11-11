import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { messages } from '../messages.ts';
import './globals.css';

// §13: pages render per request, never from a shared cache. Reading the request's nonce below does that too; saying
// it here keeps it true if that line ever goes.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: messages.app.name,
  description: messages.app.description,
};

// The app follows the system's light or dark (§05) by putting `.dark` on <html> before the first paint. It's the one
// inline script we write, and it runs only because it carries the request's nonce. The switch in Account settings
// (#79) brings next-themes and replaces this.
const FOLLOW_SYSTEM_THEME = `(() => {
  const query = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => { document.documentElement.classList.toggle('dark', query.matches); };
  apply();
  query.addEventListener('change', apply);
})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce}>{FOLLOW_SYSTEM_THEME}</script>
      </head>
      <body>{children}</body>
    </html>
  );
}
