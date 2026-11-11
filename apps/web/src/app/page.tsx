import { messages } from '../messages.ts';

// The placeholder the sign-in and signed-in pages (#77 to #79) replace. Built only from the tokens, so it shows the
// theme in light and dark; every word comes from messages/en.json.
const swatches = [
  { name: 'background', fill: 'bg-background' },
  { name: 'card', fill: 'bg-card' },
  { name: 'primary', fill: 'bg-primary' },
  { name: 'muted', fill: 'bg-muted' },
] as const;

export default function Home() {
  const { home } = messages;
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center p-6">
      <section className="flex flex-col gap-4 rounded-lg border bg-card p-6 text-card-foreground">
        <p className="text-eyebrow font-(weight:--font-weight-eyebrow) text-muted-foreground uppercase">
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
