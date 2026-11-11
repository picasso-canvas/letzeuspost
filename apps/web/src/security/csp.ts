// The app's content security policy (§13 Security summary, §16: essential cookies only, no tracking scripts). Every
// source is our own origin: no third-party script, style, font, image or connection is allowed, so a tracker could not
// load even if someone added one. Scripts run only with the request's nonce; `proxy.ts` makes one per request.

/** A nonce is 16 random bytes (128 bits) in base64, new for every request. */
export function newNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
}

/** What a nonce may look like: base64 only, so it can never close the quote or add a directive. */
const NONCE = /^[A-Za-z0-9+/]{16,}={0,2}$/;

export interface PolicyOptions {
  /** `next dev` needs eval for its refresh and error overlay; a production build never does. */
  readonly development: boolean;
  /** Served over https: ask the browser to upgrade any plain-http request. Off on a plain-http Mac. */
  readonly https?: boolean;
}

export function contentSecurityPolicy(nonce: string, options: PolicyOptions): string {
  if (!NONCE.test(nonce)) throw new Error('content security policy: the nonce is not base64');
  const scripts = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (options.development) scripts.push("'unsafe-eval'");
  const directives = [
    "default-src 'self'",
    `script-src ${scripts.join(' ')}`,
    // Tailwind's output is a file; the nonce covers the few <style> tags Next.js itself writes.
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (options.https === true) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
