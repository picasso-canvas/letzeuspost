import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { messages } from '../messages.ts';
import { INBOX, openWorkspace } from './app/workspace.ts';

// `/`, where the proxy and an opened sign-in link send a signed-in person (#78). With a workspace they go on to the
// Inbox, under /app (Q13, #79); with none yet (an invite comes later), they stay on this placeholder. It never sends
// anyone back to /sign-in, so the redirects can't loop: /app sends a person with no workspace here, and here sends only
// one with a workspace there.
//
// The placeholder is built only from the tokens, so it shows the theme in light and dark; every word comes from
// messages/en.json.
const swatches = [
  { name: 'background', fill: 'bg-background' },
  { name: 'card', fill: 'bg-card' },
  { name: 'primary', fill: 'bg-primary' },
  { name: 'muted', fill: 'bg-muted' },
] as const;

function Placeholder() {
  const { home } = messages;
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center p-6">
      <section className="flex flex-col gap-4 rounded-lg border bg-card p-6 text-card-foreground">
        <p className="text-eyebrow font-(weight:--font-weight-eyebrow) tracking-eyebrow text-faint uppercase">
          {home.eyebrow}
        </p>
        <h1 className="text-h1 font-(weight:--font-weight-h1) text-balance">{home.heading}</h1>
        <p className="text-pretty text-muted-foreground">{home.body}</p>
        <ul aria-label={home.swatchesLabel} className="grid grid-cols-4 gap-3">
          {swatches.map(({ name, fill }) => (
            <li key={name} className="flex flex-col gap-2">
              <span aria-hidden="true" className={`h-12 rounded-md border ${fill}`} />
              <span className="text-meta text-muted-foreground">{home.swatches[name]}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

/** The guard's answer for this request: a person with a workspace goes to the Inbox; anyone else sees the placeholder. */
async function ToWorkspace() {
  const opened = await openWorkspace();
  if (opened.ok) redirect(INBOX);
  return <Placeholder />;
}

// The page itself stays a plain function that draws the placeholder while the guard answers (messages.test.ts draws it
// that way, outside a request); the answer then replaces it with the same placeholder, or sends the person on.
export default function Home() {
  return (
    <Suspense fallback={<Placeholder />}>
      <ToWorkspace />
    </Suspense>
  );
}
