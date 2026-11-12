'use client';

import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
} from '@lzp/ui';
import { MailIcon } from '@lzp/ui/components/icons';
import { messages } from '../../messages.ts';
import { failureOf, type Failure } from './outcome.ts';

const { signIn } = messages;

/** Better Auth's endpoint for asking for a link (packages/auth's SERVED_ENDPOINTS), on the app's own origin. */
const ASK_FOR_LINK = '/api/auth/sign-in/magic-link';
/** Where an opened link lands a signed-in person (the Inbox), and where a refused one goes back to. */
const AFTER_SIGN_IN = '/';
const BACK_TO_SIGN_IN = '/sign-in';

type Step =
  | { name: 'asking'; email: string; sending: boolean; failure: Failure | null }
  | { name: 'sent'; email: string };

/** Asks the API for a link. Resolves to null when it took the request, or to why it didn't. */
async function askForLink(email: string): Promise<Failure | null> {
  let response: Response;
  try {
    response = await fetch(ASK_FOR_LINK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        callbackURL: AFTER_SIGN_IN,
        errorCallbackURL: BACK_TO_SIGN_IN,
      }),
    });
  } catch {
    return 'network';
  }
  if (response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  return failureOf(response.status, body);
}

/**
 * The card: the email field and its button, then "check your email" in its place (the invite-accept card's pattern,
 * Q10). The same answer for every address (Q9). `linkProblem` is true when the page was opened by a refused link.
 */
export function SignInForm({ linkProblem }: { linkProblem: boolean }) {
  const [step, setStep] = useState<Step>({
    name: 'asking',
    email: '',
    sending: false,
    failure: null,
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returning = useRef(false);
  const field = useId();
  const problem = `${field}-problem`;
  const sent = step.name === 'sent';

  // "Check your email" replaces the form: a keyboard or screen-reader user lands on it, not on nothing. Going back
  // to the form puts the focus in its field.
  useEffect(() => {
    if (sent) heading.current?.focus();
    else if (returning.current) input.current?.focus();
    returning.current = false;
  }, [sent]);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step.name !== 'asking' || step.sending) return;
    const email = step.email.trim();
    // Nothing to send: the same words the API's own refusal of a bad address gets.
    if (email === '') {
      setStep({ ...step, failure: 'invalidEmail' });
      return;
    }
    setStep({ ...step, sending: true, failure: null });
    const failure = await askForLink(email);
    setStep(
      failure === null
        ? { name: 'sent', email }
        : { name: 'asking', email: step.email, sending: false, failure },
    );
  };

  return (
    <section className="flex flex-col gap-5 rounded-lg border bg-card p-5 text-card-foreground">
      <header className="flex flex-col gap-1">
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-h2 font-(weight:--font-weight-h2) outline-none"
        >
          {sent ? signIn.sent.heading : signIn.heading}
        </h1>
        <p className="text-pretty break-words text-muted-foreground">
          {step.name === 'sent' ? signIn.sent.body.replace('{email}', step.email) : signIn.intro}
        </p>
      </header>

      {step.name === 'sent' ? (
        <div className="flex flex-col gap-4">
          <p className="text-meta text-faint">{signIn.sent.spam}</p>
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              returning.current = true;
              setStep({ name: 'asking', email: '', sending: false, failure: null });
            }}
          >
            {signIn.sent.again}
          </Button>
        </div>
      ) : (
        <form noValidate onSubmit={(event) => void submit(event)}>
          <FieldGroup className="gap-4">
            {linkProblem && <FieldError>{signIn.linkProblem}</FieldError>}
            <Field data-invalid={step.failure !== null || undefined}>
              <FieldLabel htmlFor={field}>{signIn.emailLabel}</FieldLabel>
              <Input
                ref={input}
                id={field}
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={step.email}
                aria-invalid={step.failure !== null || undefined}
                aria-describedby={step.failure === null ? undefined : problem}
                onChange={(event) => {
                  setStep({ ...step, email: event.target.value });
                }}
              />
              {step.failure === null ? (
                <FieldDescription>{signIn.emailHint}</FieldDescription>
              ) : (
                <FieldError id={problem}>{signIn.errors[step.failure]}</FieldError>
              )}
            </Field>
            <Button type="submit" className="w-full" disabled={step.sending}>
              <MailIcon data-icon="inline-start" aria-hidden="true" />
              {step.sending ? signIn.sending : signIn.submit}
            </Button>
          </FieldGroup>
        </form>
      )}
    </section>
  );
}
