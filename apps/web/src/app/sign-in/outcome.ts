// What the sign-in page makes of the API's answers. The page never shows the API's own message (English meant for a
// developer): it picks one of its own, in messages/en.json, by the answer's status and code, never by its words.

/**
 * Which of the page's messages a request for a link that didn't go through gets (`signIn.errors` in messages/en.json):
 * `network` is for one that never got an answer, the rest for the API's refusals (`failureOf`).
 */
export type Failure = 'invalidEmail' | 'tooManyRequests' | 'unknownClient' | 'generic' | 'network';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * The failure for a refused `POST /api/auth/sign-in/magic-link`: its HTTP status and its JSON body, if it had one.
 * A 429 is "too many" with or without our body (a limit in front of the app answers with a page); the rest need the
 * status and the code to agree.
 */
export function failureOf(status: number, body: unknown): Exclude<Failure, 'network'> {
  if (status === 429) return 'tooManyRequests';
  const code = isRecord(body) ? body['code'] : undefined;
  if (status === 400 && code === 'VALIDATION_ERROR') return 'invalidEmail';
  if (status === 400 && code === 'CLIENT_IP_UNKNOWN') return 'unknownClient';
  return 'generic';
}

/**
 * Whether the page was opened by a refused link: the magic link's check sends it back to `/sign-in?error=…`. Every
 * code (an unknown, used or expired link; rarer breaks) means the same to a person: ask for a new link.
 */
export function linkProblem(error: string | string[] | undefined): boolean {
  const first = Array.isArray(error) ? error[0] : error;
  return first !== undefined && first !== '';
}
